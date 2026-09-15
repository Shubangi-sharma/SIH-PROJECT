"""Historical seeding — populate the 552 frozen hotspots + initial predictions.

Sources (first available wins):
1. `PYROSENSE_HISTORICAL_CSV` — the original enriched training CSV with the 36
   feature columns + latitude/longitude (+ optional label). This is the
   PREFERRED source: frozen, exact, reproducible.
2. SQLite clustering fallback — derive hotspots from the Node backend's
   detections. Clearly marked `dataset_version=0.0.0-sqlite-fallback` so
   downstream consumers can tell these apart from the frozen dataset.

Every seeded hotspot gets an initial prediction computed by THIS service's
model pipeline, so /hotspots is immediately useful.
"""

from __future__ import annotations

import csv
import logging
import os
from pathlib import Path

import pandas as pd
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.data.live import SOURCE_LIVE, save_prediction
from app.db.models import Hotspot
from app.feature_schema import (
    DATASET_VERSION,
    FEATURE_NAMES,
    LEAKAGE_COLUMNS,
    MODEL_CLASSES,
    SCHEMA_VERSION,
    TRAINING_MEDIANS,
    validate_features,
)
from app.ml.inference import predict as run_inference
from app.ml.risk_score import compute_risk_score, key_contributors

logger = logging.getLogger("pyrosense.seed")

SQLITE_FALLBACK_VERSION = "0.0.0-sqlite-fallback"


def _extract_coords(row: dict) -> tuple[float, float] | None:
    lat = row.get("latitude") or row.get("lat")
    lng = row.get("longitude") or row.get("lng") or row.get("lon")
    if lat in (None, "") or lng in (None, ""):
        return None
    try:
        return float(lat), float(lng)
    except (TypeError, ValueError):
        return None


def _coerce_features(row: dict) -> dict[str, object]:
    feats: dict[str, object] = {}
    for name in FEATURE_NAMES:
        v = row.get(name)
        if v in (None, ""):
            continue
        if name == "dominant_land_cover":
            feats[name] = str(v).strip().lower().replace(" ", "_")
        else:
            try:
                feats[name] = float(v)
            except (TypeError, ValueError):
                continue
    return feats


def load_historical_csv(path: Path) -> list[dict]:
    """Parse the enriched CSV into seed rows (features + coords + optional label)."""
    df = pd.read_csv(path)
    df.columns = [c.strip() for c in df.columns]
    rows: list[dict] = []
    for i, raw in df.iterrows():
        row = raw.to_dict()
        coords = _extract_coords(row)
        if coords is None:
            logger.warning("row %d: missing latitude/longitude — skipped", i)
            continue
        feats = _coerce_features(row)
        valid = validate_features(feats, strict=False)
        if len(valid) < len(FEATURE_NAMES) // 2:
            logger.warning("row %d: <50%% of features present — skipped", i)
            continue
        label = row.get("label") or row.get("class") or row.get("target")
        rows.append(
            {
                "latitude": coords[0],
                "longitude": coords[1],
                "features": valid,
                "label": str(label).strip() if label else None,
                "hotspot_uid": str(row.get("hotspot_id") or f"hist-{i + 1:04d}"),
            }
        )
    return rows


def derive_from_sqlite(min_detections: int = 5, limit: int = 552) -> list[dict]:
    """Fallback: grid-cluster the Node backend's detections into hotspots.

    These are NOT the frozen 552 — they are what the current 3-day NRT window
    supports, marked with a distinct dataset_version.
    """
    from app.data.live import detection_history_query_sqlite  # noqa: F401
    from app.db.engine import sqlite_connect_readonly
    from collections import defaultdict

    con = sqlite_connect_readonly()
    try:
        rows = con.execute(
            "SELECT lat, lng, frp, acq_date FROM firms_detections ORDER BY acq_date"
        ).fetchall()
    finally:
        con.close()

    clusters: dict[tuple, list] = defaultdict(list)
    for r in rows:
        key = (round(r["lat"] * 100) / 100, round(r["lng"] * 100) / 100)
        clusters[key].append(r)

    out: list[dict] = []
    for (lat, lng), dets in clusters.items():
        if len(dets) < min_detections:
            continue
        dates = sorted(d["acq_date"] for d in dets)
        frps = [d["frp"] or 0.0 for d in dets]
        derived = {
            "total_detections": float(len(dets)),
            "unique_days": float(len(set(dates))),
            "unique_months": float(len({(d[:4], d[5:7]) for d in dates})),
            "active_duration_days": 0.0,
            "mean_FRP": sum(frps) / len(frps),
            "max_FRP": max(frps),
            "first_detection_year": float(dates[0][:4]),
            "first_detection_month": float(dates[0][5:7]),
            "last_detection_year": float(dates[-1][:4]),
            "last_detection_month": float(dates[-1][5:7]),
        }
        # The 3-day NRT window cannot supply OSM/land-cover/weather context.
        # Fill those from training medians (documented synthetic fallback —
        # rows carry dataset_version=0.0.0-sqlite-fallback for traceability).
        feats = {"dominant_land_cover": "bare", **TRAINING_MEDIANS, **derived}
        out.append(
            {
                "latitude": lat,
                "longitude": lng,
                "features": feats,
                "label": None,
                "hotspot_uid": f"hist-sqlite-{lat:.2f}_{lng:.2f}",
            }
        )
        if len(out) >= limit:
            break
    return out


async def seed_if_empty(session: AsyncSession) -> int:
    """Seed historical hotspots when the table has none. Returns rows seeded."""
    existing = (
        await session.execute(
            select(func.count()).select_from(Hotspot).where(Hotspot.source == "historical")
        )
    ).scalar_one()

    csv_path = os.environ.get("PYROSENSE_HISTORICAL_CSV")
    if existing == 0:
        if csv_path and Path(csv_path).exists():
            rows = load_historical_csv(Path(csv_path))
            dataset_version = DATASET_VERSION
        else:
            if csv_path:
                logger.warning("PYROSENSE_HISTORICAL_CSV set but missing: %s", csv_path)
            rows = derive_from_sqlite()
            dataset_version = SQLITE_FALLBACK_VERSION
        seeded = await _seed_rows(session, rows, dataset_version)
        logger.info("seeded %d historical hotspots (dataset=%s)", seeded, dataset_version)
        return seeded
    return 0


async def _seed_rows(session: AsyncSession, rows: list[dict], dataset_version: str) -> int:
    seeded = 0
    for row in rows:
        feats = row["features"]
        try:
            result = run_inference(feats)
        except Exception as exc:
            logger.warning("hotspot %s: inference failed (%s) — skipped", row["hotspot_uid"], exc)
            continue
        risk = compute_risk_score(result.probabilities)
        drivers = key_contributors(result.features, top_k=5)

        hotspot = Hotspot(
            hotspot_uid=row["hotspot_uid"],
            source="historical",
            latitude=row["latitude"],
            longitude=row["longitude"],
            feature_snapshot=feats,
        )
        session.add(hotspot)
        await session.flush()

        await save_prediction(
            session,
            hotspot=hotspot,
            result=result,
            risk_score=risk,
            top_contributing_features=drivers,
            source="historical",
            dataset_version=dataset_version,
        )
        seeded += 1
    await session.commit()
    return seeded
