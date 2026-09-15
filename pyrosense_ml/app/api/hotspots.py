"""Hotspot endpoints — map list, full detail, 10-day timeline."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.health import get_db
from app.data.historical import HotspotSummary, get_hotspot_with_latest, list_hotspots
from app.data.timeline import get_timeline
from app.feature_schema import FEATURE_NAMES

router = APIRouter(prefix="/hotspots")


def _summary_dict(s: HotspotSummary) -> dict:
    return {
        "hotspot_id": s.hotspot_uid,
        "latitude": s.latitude,
        "longitude": s.longitude,
        "class": s.predicted_class,
        "confidence": s.confidence,
        "risk_score": s.risk_score,
        "source": s.source,
        "model_version": s.model_version,
    }


@router.get("")
async def hotspots(
    source: str | None = Query(default=None, pattern="^(historical|live)$"),
    min_lat: float | None = Query(default=None, ge=-90, le=90),
    max_lat: float | None = Query(default=None, ge=-90, le=90),
    min_lng: float | None = Query(default=None, ge=-180, le=180),
    max_lng: float | None = Query(default=None, ge=-180, le=180),
    session: AsyncSession = Depends(get_db),
):
    summaries = await list_hotspots(
        session,
        source=source,
        min_lat=min_lat,
        max_lat=max_lat,
        min_lng=min_lng,
        max_lng=max_lng,
    )
    return {
        "count": len(summaries),
        "hotspots": [_summary_dict(s) for s in summaries],
    }


@router.get("/{hotspot_uid}/timeline")
async def hotspot_timeline(
    hotspot_uid: str,
    days: int = Query(default=10, ge=1, le=90),
    session: AsyncSession = Depends(get_db),
):
    found = await get_hotspot_with_latest(session, hotspot_uid)
    if found is None:
        raise HTTPException(status_code=404, detail=f"hotspot {hotspot_uid!r} not found")
    hotspot, _latest = found
    points = await get_timeline(session, hotspot_id=hotspot.id, days=days)
    return {
        "hotspot_id": hotspot_uid,
        "days": len(points),
        "timeline": [p.to_dict() for p in points],
    }


@router.get("/{hotspot_uid}")
async def hotspot_detail(hotspot_uid: str, session: AsyncSession = Depends(get_db)):
    found = await get_hotspot_with_latest(session, hotspot_uid)
    if found is None:
        raise HTTPException(status_code=404, detail=f"hotspot {hotspot_uid!r} not found")
    hotspot, pred = found

    features = pred.feature_snapshot if pred else hotspot.feature_snapshot
    return {
        "hotspot_id": hotspot.hotspot_uid,
        "latitude": hotspot.latitude,
        "longitude": hotspot.longitude,
        "region": hotspot.region,
        "source": hotspot.source,
        "prediction": (
            {
                "class": pred.predicted_class,
                "confidence": pred.confidence,
                "risk_score": pred.risk_score,
                "probabilities": pred.probabilities,
                "top_contributing_features": pred.top_contributing_features,
                "model_version": pred.model_version,
                "dataset_version": pred.dataset_version,
                "feature_schema_version": pred.feature_schema_version,
                "prediction_timestamp": pred.prediction_timestamp.isoformat(),
            }
            if pred
            else None
        ),
        "feature_snapshot": features,
        "feature_count": len(features or {}),
        "expected_features": list(FEATURE_NAMES),
    }
