"""Historical data access — the frozen 552-hotspot dataset (source='historical').

Read paths used by the API. Writes only happen via scripts/seed_historical.py
(historical rows are immutable once seeded).
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Hotspot, Prediction


@dataclass
class HotspotSummary:
    hotspot_uid: str
    latitude: float
    longitude: float
    predicted_class: str | None
    confidence: float | None
    risk_score: float | None
    source: str
    model_version: str | None = None


def _latest_prediction_subq() -> Select:
    """Latest prediction timestamp per hotspot (correlated max)."""
    return (
        select(
            Prediction.hotspot_id,
            func.max(Prediction.prediction_timestamp).label("max_ts"),
        )
        .group_by(Prediction.hotspot_id)
        .subquery()
    )


async def list_hotspots(
    session: AsyncSession,
    *,
    source: str | None = None,
    min_lat: float | None = None,
    max_lat: float | None = None,
    min_lng: float | None = None,
    max_lng: float | None = None,
    limit: int = 2000,
) -> list[HotspotSummary]:
    """Map-ready hotspot summaries with their latest prediction attached."""
    latest = _latest_prediction_subq()
    stmt = (
        select(Hotspot, Prediction)
        .join(Prediction, Prediction.hotspot_id == Hotspot.id)
        .join(
            latest,
            (latest.c.hotspot_id == Hotspot.id)
            & (latest.c.max_ts == Prediction.prediction_timestamp),
        )
    )
    if source:
        stmt = stmt.where(Hotspot.source == source)
    if min_lat is not None:
        stmt = stmt.where(Hotspot.latitude >= min_lat)
    if max_lat is not None:
        stmt = stmt.where(Hotspot.latitude <= max_lat)
    if min_lng is not None:
        stmt = stmt.where(Hotspot.longitude >= min_lng)
    if max_lng is not None:
        stmt = stmt.where(Hotspot.longitude <= max_lng)
    stmt = stmt.limit(limit)

    rows = (await session.execute(stmt)).all()
    return [
        HotspotSummary(
            hotspot_uid=hotspot.hotspot_uid,
            latitude=hotspot.latitude,
            longitude=hotspot.longitude,
            predicted_class=pred.predicted_class,
            confidence=pred.confidence,
            risk_score=pred.risk_score,
            source=hotspot.source,
            model_version=pred.model_version,
        )
        for hotspot, pred in rows
    ]


async def get_hotspot_with_latest(
    session: AsyncSession, hotspot_uid: str
) -> tuple[Hotspot, Prediction | None] | None:
    hotspot = (
        await session.execute(select(Hotspot).where(Hotspot.hotspot_uid == hotspot_uid))
    ).scalar_one_or_none()
    if hotspot is None:
        return None
    pred = (
        await session.execute(
            select(Prediction)
            .where(Prediction.hotspot_id == hotspot.id)
            .order_by(Prediction.prediction_timestamp.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    return hotspot, pred


async def count_by_source(session: AsyncSession, source: str) -> int:
    return (
        await session.execute(
            select(func.count()).select_from(Hotspot).where(Hotspot.source == source)
        )
    ).scalar_one()
