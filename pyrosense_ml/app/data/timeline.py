"""Timeline access — daily snapshots powering the frontend slider.

GET /hotspots/{id}/timeline returns the last N (default 10) daily snapshots,
each carrying date, risk_score, class, confidence, key_drivers, and source.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import TimelineSnapshot


@dataclass
class TimelinePoint:
    date: date
    risk_score: float
    predicted_class: str
    confidence: float
    key_drivers: list = field(default_factory=list)
    source: str = "live"

    def to_dict(self) -> dict:
        return {
            "date": self.date.isoformat(),
            "risk_score": self.risk_score,
            "class": self.predicted_class,
            "confidence": self.confidence,
            "key_drivers": self.key_drivers,
            "source": self.source,
        }


async def get_timeline(
    session: AsyncSession,
    *,
    hotspot_id: int,
    days: int = 10,
) -> list[TimelinePoint]:
    """Last `days` daily snapshots, oldest → newest."""
    rows = (
        await session.execute(
            select(TimelineSnapshot)
            .where(TimelineSnapshot.hotspot_id == hotspot_id)
            .order_by(TimelineSnapshot.snapshot_date.desc())
            .limit(days)
        )
    ).scalars().all()
    return [
        TimelinePoint(
            date=r.snapshot_date,
            risk_score=r.risk_score,
            predicted_class=r.predicted_class,
            confidence=r.confidence,
            key_drivers=list(r.key_drivers or []),
            source=r.source,
        )
        for r in reversed(rows)
    ]
