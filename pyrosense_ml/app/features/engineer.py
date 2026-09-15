"""Feature engineering — compute all 36 model features for a live point.

Orchestration contract:
- Every feature is computed or medians-filled; the output ALWAYS has all 36
  keys in the frozen schema, so the schema validator never sees NaN.
- Each block carries provenance; `complete=False` blocks (external sources
  unavailable) are filled with training medians and their provenance marked
  "median_fallback", so callers can decide whether to trust the prediction.
"""

from __future__ import annotations

import logging
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from app.config import settings
from app.data.live import detection_history_query_sqlite
from app.db.engine import sqlite_connect_readonly
from app.feature_schema import FEATURE_NAMES, NUMERIC_FEATURES, TRAINING_MEDIANS
from app.features.land_cover import get_land_cover
from app.features.osm_distances import get_osm_distances
from app.features.weather import WEATHER_FEATURES, get_weather

logger = logging.getLogger("pyrosense.ml.features.engineer")


@dataclass
class EngineeredFeatures:
    features: dict[str, object] = field(default_factory=dict)
    provenance: dict[str, str] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)

    @property
    def complete(self) -> bool:
        return all(p != "median_fallback" for p in self.provenance.values())


def _fill_medians(features: dict[str, object], block: list[str]) -> None:
    for name in block:
        if features.get(name) is None:
            features[name] = TRAINING_MEDIANS[name]


async def engineer_features(
    latitude: float,
    longitude: float,
    *,
    detection_radius_km: float | None = None,
    lookback_days: int = 365,
) -> EngineeredFeatures:
    """Compute the full 36-feature vector for a point.

    Persistence/FRP features come from the Node backend's SQLite detections;
    OSM distances, land cover, and weather from their respective modules with
    median fallback on failure.
    """
    radius = detection_radius_km or settings.DETECTION_RADIUS_KM
    out = EngineeredFeatures()

    # ── 1. Persistence + FRP from SQLite detection history ─────────────────
    det: dict[str, object] = {}
    try:
        det = _detection_features(latitude, longitude, radius, lookback_days)
        out.provenance["detections"] = "sqlite"
    except (sqlite3.Error, FileNotFoundError) as exc:
        out.warnings.append(f"detection history unavailable: {exc}")
        out.provenance["detections"] = "median_fallback"
    finally:
        _fill_medians(det, PERSISTENCE_FEATURES + FRP_FEATURES + TEMPORAL_FEATURES)
        out.features.update(det)

    # ── 2. OSM distances ────────────────────────────────────────────────────
    osm = await get_osm_distances(latitude, longitude)
    if all(v is None for v in osm.distances.values()):
        out.warnings.append("OSM distances unavailable — median fallback applied")
        out.provenance["osm"] = "median_fallback"
        dist = {k: TRAINING_MEDIANS[k] for k in OSM_FEATURES}
    else:
        out.provenance["osm"] = "cache" if osm.cached else "overpass"
        dist = {k: v if v is not None else TRAINING_MEDIANS[k] for k, v in osm.distances.items()}
    out.features.update(dist)

    # ── 3. Land cover ───────────────────────────────────────────────────────
    lc = await get_land_cover(latitude, longitude)
    if lc.features.get("land_cover_observations", 0) == 0:
        out.warnings.append("land cover derived without observations — prior fallback")
        out.provenance["land_cover"] = "median_fallback"
    else:
        out.provenance["land_cover"] = lc.provenance
    out.features.update(lc.features)

    # ── 4. Weather ──────────────────────────────────────────────────────────
    wx = await get_weather(latitude, longitude)
    if wx.provenance == "unavailable":
        out.warnings.append("weather unavailable — median fallback applied")
        out.provenance["weather"] = "median_fallback"
        weather = {k: TRAINING_MEDIANS[k] for k in WEATHER_FEATURES if k in TRAINING_MEDIANS}
    else:
        out.provenance["weather"] = wx.provenance
        weather = dict(wx.features)
    _fill_medians(weather, WEATHER_FEATURES)
    out.features.update(weather)

    # ── Final guard: all 36 features present, no None ────────────────────────
    missing = [n for n in FEATURE_NAMES if n not in out.features]
    if missing:
        raise RuntimeError(f"feature engineer produced incomplete vector: missing {missing}")
    for n in NUMERIC_FEATURES:
        if out.features[n] is None:
            out.features[n] = TRAINING_MEDIANS[n]

    return out


PERSISTENCE_FEATURES = [
    "total_detections",
    "unique_days",
    "unique_months",
    "active_duration_days",
]
FRP_FEATURES = ["mean_FRP", "max_FRP"]
OSM_FEATURES = [
    "distance_to_industrial_km",
    "distance_to_power_km",
    "distance_to_mining_km",
    "distance_to_fuel_storage_km",
    "distance_to_agriculture_km",
    "distance_to_transport_km",
]
TEMPORAL_FEATURES = [
    "first_detection_year",
    "first_detection_month",
    "last_detection_year",
    "last_detection_month",
]


def _detection_features(
    lat: float,
    lng: float,
    radius_km: float,
    lookback_days: int,
) -> dict[str, object]:
    """Persistence/FRP/temporal features from stored FIRMS detections."""
    sql, params = detection_history_query_sqlite(lat, lng, radius_km, _since(lookback_days))
    con = sqlite_connect_readonly()
    try:
        rows = con.execute(sql, params).fetchall()
    finally:
        con.close()

    if not rows:
        return {
            "total_detections": 0.0,
            "unique_days": 0.0,
            "unique_months": 0.0,
            "active_duration_days": 0.0,
            "mean_FRP": 0.0,
            "max_FRP": 0.0,
            "first_detection_year": 0.0,
            "first_detection_month": 0.0,
            "last_detection_year": 0.0,
            "last_detection_month": 0.0,
        }

    dates = sorted({r["acq_date"] for r in rows})
    months = {(d[:4], d[5:7]) for d in dates}
    frps = [r["frp"] or 0.0 for r in rows]
    first, last = dates[0], dates[-1]

    return {
        "total_detections": float(len(rows)),
        "unique_days": float(len(dates)),
        "unique_months": float(len(months)),
        "active_duration_days": float(
            (datetime.strptime(last, "%Y-%m-%d") - datetime.strptime(first, "%Y-%m-%d")).days
        ),
        "mean_FRP": sum(frps) / len(frps),
        "max_FRP": max(frps),
        "first_detection_year": float(first[:4]),
        "first_detection_month": float(first[5:7]),
        "last_detection_year": float(last[:4]),
        "last_detection_month": float(last[5:7]),
    }


def _since(lookback_days: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=lookback_days)
