"""Hotspot persistence pipeline — H3-8 indexing, DBSCAN clustering,
persistence rule, contextual classification.

Contract (Phase 2C, per the handoff PDF's hotspot detection spec):
- Detections over the lookback window are grouped into clusters via DBSCAN
  over detection coordinates with haversine metric, eps=2 km, min_samples=2.
- A cluster is PERSISTENT iff it spans >= 5 unique fire days (PDF rule).
- Persistent clusters get the MLP's contextual classification (43 features
  built from cluster detections + OSM + land cover + weather), with the
  documented Unknown/Needs Review path: low-confidence results are stored
  with needs_review=True and surfaced as "Needs Review" by the API —
  the classifier is NEVER forced into one of the five classes when the
  evidence is ambiguous (PDF caveat #3).
- Results upsert into hotspot_clusters (cluster_uid is deterministic from
  the centroid so re-runs update rather than duplicate).

Known approximation: H3-r8 indexes each cluster's CENTROID for map
grouping; membership itself is DBSCAN's, not an H3 cell containment test.
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta

import h3
import numpy as np
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sklearn.cluster import DBSCAN
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import HotspotCluster, LiveDetection
from app.feature_schema import CLASSIFIER_CLASSES, CLASSIFIER_MODEL_VERSION, SCHEMA_VERSION

logger = logging.getLogger("pyrosense.ml.pipeline.hotspots")

PERSISTENT_MIN_FIRE_DAYS = 5
DBSCAN_EPS_KM = 2.0
DBSCAN_MIN_SAMPLES = 2

# Confidence below this → needs_review (the Unknown path). Chosen so the five
# real classes stay distinguishable; surfaced in UI as "Needs Review", never
# renamed to a sixth class.
NEEDS_REVIEW_CONFIDENCE = 0.40

EARTH_RADIUS_KM = 6371.0088


@dataclass
class ClusterOut:
    centroid_lat: float
    centroid_lng: float
    h3_cell: str
    unique_fire_days: int
    total_detections: int
    first_seen: date
    last_seen: date
    is_persistent: bool


def haversine_km_matrix(latlngs: np.ndarray) -> np.ndarray:
    """Pairwise haversine distances (km) for an (N, 2) lat/lng array."""
    lat = np.radians(latlngs[:, 0])
    lng = np.radians(latlngs[:, 1])
    dlat = lat[:, None] - lat[None, :]
    dlng = lng[:, None] - lng[None, :]
    a = (
        np.sin(dlat / 2.0) ** 2
        + np.cos(lat)[:, None] * np.cos(lat)[None, :] * np.sin(dlng / 2.0) ** 2
    )
    return 2.0 * EARTH_RADIUS_KM * np.arcsin(np.sqrt(np.clip(a, 0.0, 1.0)))


def cluster_detections(
    latlngs: np.ndarray,
    *,
    eps_km: float = DBSCAN_EPS_KM,
    min_samples: int = DBSCAN_MIN_SAMPLES,
) -> np.ndarray:
    """DBSCAN labels (-1 = noise) using the haversine metric on km."""
    if len(latlngs) == 0:
        return np.zeros((0,), dtype=int)
    if len(latlngs) < min_samples:
        return np.full((len(latlngs),), -1, dtype=int)
    dist = haversine_km_matrix(latlngs)
    return DBSCAN(eps=eps_km, min_samples=min_samples, metric="precomputed").fit_predict(dist)


def _cluster_uid(lat: float, lng: float) -> str:
    """Deterministic uid from the centroid (1/1000° ≈ 111 m grid)."""
    key = f"{round(lat, 3):.3f},{round(lng, 3):.3f}"
    digest = hashlib.sha1(key.encode()).hexdigest()[:12]
    return f"HC-{digest}"


def build_clusters(dets: list) -> list[ClusterOut]:
    """DBSCAN-group detections and derive per-cluster aggregates."""
    if not dets:
        return []
    latlngs = np.array([[float(d.latitude), float(d.longitude)] for d in dets])
    labels = cluster_detections(latlngs)

    out: list[ClusterOut] = []
    for label in sorted(set(labels)):
        if label == -1:
            continue
        members = [d for d, lab in zip(dets, labels) if lab == label]
        lats = [float(d.latitude) for d in members]
        lngs = [float(d.longitude) for d in members]
        days = sorted({d.acq_date for d in members})
        centroid_lat = float(np.mean(lats))
        centroid_lng = float(np.mean(lngs))
        out.append(
            ClusterOut(
                centroid_lat=centroid_lat,
                centroid_lng=centroid_lng,
                h3_cell=h3.latlng_to_cell(centroid_lat, centroid_lng, 8),
                unique_fire_days=len(days),
                total_detections=len(members),
                first_seen=days[0],
                last_seen=days[-1],
                is_persistent=len(days) >= PERSISTENT_MIN_FIRE_DAYS,
            )
        )
    return out


async def run_hotspot_pipeline(
    session: AsyncSession,
    *,
    lookback_days: int = 60,
    as_of: date | None = None,
) -> dict:
    """Cluster recent detections, upsert persistent ones with classification.

    Classification re-uses the /predict pipeline's engineer + classifier so a
    cluster's 43 features are built exactly like a live point's. Clusters with
    max confidence < NEEDS_REVIEW_CONFIDENCE keep needs_review=True.

    Returns counters for /internal/health reporting.
    """
    from app.features.engineer import engineer_features
    from app.ml.inference import predict as run_inference

    as_of = as_of or date.today()
    since = as_of - timedelta(days=lookback_days)

    dets = (
        (
            await session.execute(
                select(LiveDetection).where(
                    LiveDetection.acq_date >= since,
                    LiveDetection.acq_date <= as_of,
                )
            )
        )
        .scalars()
        .all()
    )
    clusters = build_clusters(list(dets))
    persistent = [c for c in clusters if c.is_persistent]

    classified = 0
    needs_review = 0
    for c in persistent:
        # Classification context from the centroid; engineer_features applies
        # its own documented fallbacks per block on failure.
        try:
            engineered = await engineer_features(c.centroid_lat, c.centroid_lng)
            result = run_inference(engineered.features)
            predicted_class = result.predicted_class
            confidence = result.confidence
            probs = result.probabilities
            feature_snapshot = dict(result.features)
            model_version = CLASSIFIER_MODEL_VERSION
            classified += 1
            review = confidence < NEEDS_REVIEW_CONFIDENCE
            if review:
                needs_review += 1
            warnings = engineered.warnings
        except Exception as exc:  # noqa: BLE001 — classification must not kill the pipeline
            logger.warning(
                "classification failed for cluster at (%.3f,%.3f): %s", c.centroid_lat, c.centroid_lng, exc
            )
            predicted_class = None
            confidence = None
            probs = None
            feature_snapshot = {}
            model_version = None
            review = True  # unclassifiable → review path
            warnings = [f"classification unavailable: {exc}"]

        row = {
            "cluster_uid": _cluster_uid(c.centroid_lat, c.centroid_lng),
            "h3_cell": c.h3_cell,
            "centroid_lat": c.centroid_lat,
            "centroid_lng": c.centroid_lng,
            "unique_fire_days": c.unique_fire_days,
            "total_detections": c.total_detections,
            "first_seen": c.first_seen,
            "last_seen": c.last_seen,
            "is_persistent": c.is_persistent,
            "predicted_class": predicted_class,
            "confidence": confidence,
            "probabilities": probs,
            "needs_review": review,
            "feature_snapshot": {**feature_snapshot, "_warnings": warnings},
            "model_version": model_version,
            "updated_at": datetime.utcnow(),
        }
        stmt = pg_insert(HotspotCluster).values(row)
        stmt = stmt.on_conflict_do_update(
            constraint="uq_hotspot_clusters_cluster_uid",
            set_={
                "h3_cell": stmt.excluded.h3_cell,
                "centroid_lat": stmt.excluded.centroid_lat,
                "centroid_lng": stmt.excluded.centroid_lng,
                "unique_fire_days": stmt.excluded.unique_fire_days,
                "total_detections": stmt.excluded.total_detections,
                "first_seen": stmt.excluded.first_seen,
                "last_seen": stmt.excluded.last_seen,
                "is_persistent": stmt.excluded.is_persistent,
                "predicted_class": stmt.excluded.predicted_class,
                "confidence": stmt.excluded.confidence,
                "probabilities": stmt.excluded.probabilities,
                "needs_review": stmt.excluded.needs_review,
                "feature_snapshot": stmt.excluded.feature_snapshot,
                "model_version": stmt.excluded.model_version,
                "updated_at": stmt.excluded.updated_at,
            },
        )
        await session.execute(stmt)

    await session.flush()
    result = {
        "detections": len(dets),
        "clusters": len(clusters),
        "persistent": len(persistent),
        "classified": classified,
        "needs_review": needs_review,
        "as_of": as_of.isoformat(),
        "schema_version": SCHEMA_VERSION,
        "classes": list(CLASSIFIER_CLASSES),
    }
    logger.info("hotspot pipeline done: %s", result)
    return result
