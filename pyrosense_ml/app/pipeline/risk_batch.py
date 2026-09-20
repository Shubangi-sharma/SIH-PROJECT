"""Batch GRU risk pipeline — rolling 30-day windows → all three horizon GRUs.

Contract (Phase 2C / PDF §"rolling pipeline"):
- Eligible cells: any H3-r7 cell with >= 30 consecutive days of feature rows
  ending at `as_of` in firms_daily_h3 (consecutive = every day present).
  Cells with fewer are marked insufficient_history — NEVER a fabricated
  sequence (PDF failure-mode table).
- Each window is a (30, 17) matrix in RISK_FEATURES order, scaled with the
  frozen risk_scaler.pkl (the scaler fitted on training data only).
- All eligible cells are inferred in ONE stacked batch per horizon — a
  single (N, 30, 17) tensor per GRU, not per-cell Python loops.
- Per-horizon threshold + overall rule come from app.ml.risk_score.score_risk
  semantics (>=2 HIGH → HIGH, 1 → MODERATE, 0 → LOW); recomputed here on the
  batch output so one vectorized pass can upsert all rows.
- Every stored row carries data_timestamp = the `as_of` day's 00:00 UTC, so
  the API layer can honestly report "as of" freshness (PDF §17).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone

import numpy as np
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import FirmsDailyH3, RiskPrediction
from app.feature_schema import (
    RISK_FEATURES,
    RISK_HORIZONS,
    RISK_MODEL_VERSION,
    RISK_SEQUENCE_LENGTH,
    RISK_THRESHOLDS,
    SCHEMA_VERSION,
)

logger = logging.getLogger("pyrosense.ml.pipeline.risk")

INSUFFICIENT_HISTORY = "insufficient_history"


@dataclass
class RiskRunResult:
    as_of: date
    cells_eligible: int
    cells_insufficient: int
    rows_upserted: int


def _as_of_timestamp(as_of: date) -> datetime:
    return datetime.combine(as_of, time.min, tzinfo=timezone.utc)


def eligible_cells(
    rows: list[tuple[str, date]],
    as_of: date,
    *,
    sequence_length: int = RISK_SEQUENCE_LENGTH,
) -> tuple[dict[str, list[date]], list[str]]:
    """Split cells into (eligible with their day-list, insufficient).

    A cell is eligible iff it has exactly the last `sequence_length` calendar
    days ending at `as_of` (no gaps — a missing day would falsify the GRU's
    time axis).
    """
    by_cell: dict[str, set[date]] = {}
    for cell, day in rows:
        by_cell.setdefault(cell, set()).add(day)

    expected = [as_of - timedelta(days=i) for i in range(sequence_length)]
    expected_set = set(expected)

    eligible: dict[str, list[date]] = {}
    insufficient: list[str] = []
    for cell, days in by_cell.items():
        if expected_set.issubset(days):
            # oldest → newest so window index t=0 is 29 days ago, t=29 is as_of
            eligible[cell] = list(reversed(expected))
        else:
            insufficient.append(cell)
    return eligible, sorted(insufficient)


def build_windows(
    cell_days: dict[str, list[date]],
    feature_rows: dict[tuple[str, date], list[float]],
) -> tuple[np.ndarray, list[str]]:
    """Stack per-cell (30, 17) matrices into one (N, 30, 17) tensor.

    Order matches eligible_cells' cell ordering (sorted by cell id) — callers
    get the parallel cell list back.
    """
    cells = sorted(cell_days)
    window = np.zeros((len(cells), RISK_SEQUENCE_LENGTH, len(RISK_FEATURES)), dtype=np.float32)
    for i, cell in enumerate(cells):
        for t, day in enumerate(cell_days[cell]):
            vec = feature_rows[(cell, day)]
            window[i, t, :] = vec
    return window, cells


def _overall(high_count: int) -> str:
    if high_count >= 2:
        return "HIGH"
    if high_count == 1:
        return "MODERATE"
    return "LOW"


async def run_risk_pipeline(session: AsyncSession, *, as_of: date | None = None) -> RiskRunResult:
    """One risk-prediction pass over all eligible cells. Idempotent upsert."""
    from app.ml.model_loader import get_model

    as_of = as_of or (date.today() - timedelta(days=1))  # yesterday: last complete day
    data_ts = _as_of_timestamp(as_of)

    # 1. Candidate rows: anything in the window [as_of-29, as_of].
    window_start = as_of - timedelta(days=RISK_SEQUENCE_LENGTH - 1)
    rows = (
        (
            await session.execute(
                select(FirmsDailyH3.h3_cell, FirmsDailyH3.day, FirmsDailyH3.feature_vector).where(
                    FirmsDailyH3.day >= window_start,
                    FirmsDailyH3.day <= as_of,
                )
            )
        )
        .all()
    )

    cell_days, insufficient = eligible_cells([(c, d) for c, d, _ in rows], as_of)
    if not cell_days:
        logger.warning(
            "risk pipeline: no eligible cells as of %s (%d insufficient)",
            as_of,
            len(insufficient),
        )
        return RiskRunResult(as_of=as_of, cells_eligible=0, cells_insufficient=len(insufficient), rows_upserted=0)

    feature_rows = {(c, d): vec for c, d, vec in rows}
    window, cells = build_windows(cell_days, feature_rows)

    # 2. Scale with the FROZEN risk scaler. The scaler was fitted on
    #    (samples*30, 17); reshape to 2-D, transform, reshape back.
    models = get_model()
    n, seq_len, n_feat = window.shape
    scaled = models.risk_scaler.transform(window.reshape(-1, n_feat)).reshape(window.shape)
    scaled = scaled.astype(np.float32)

    # 3. One batched predict per horizon; threshold + overall rule vectorized.
    probs_by_horizon: dict[str, np.ndarray] = {}
    levels_by_horizon: dict[str, np.ndarray] = {}
    for horizon in RISK_HORIZONS:
        probs = models.risk_models[horizon].predict(scaled, verbose=0).reshape(-1)
        probs_by_horizon[horizon] = probs
        levels_by_horizon[horizon] = probs >= RISK_THRESHOLDS[horizon]

    high_counts = np.zeros(len(cells), dtype=np.int32)
    for horizon in RISK_HORIZONS:
        high_counts += levels_by_horizon[horizon].astype(np.int32)
    overalls = np.array([_overall(int(h)) for h in high_counts])

    # 4. Upsert one row per (cell, horizon).
    upsert_rows: list[dict] = []
    for i, cell in enumerate(cells):
        for horizon in RISK_HORIZONS:
            upsert_rows.append(
                {
                    "h3_cell": cell,
                    "horizon": horizon,
                    "probability": round(float(probs_by_horizon[horizon][i]), 6),
                    "level": "HIGH" if levels_by_horizon[horizon][i] else "LOW",
                    "overall": str(overalls[i]),
                    "model_version": RISK_MODEL_VERSION,
                    "feature_schema_version": SCHEMA_VERSION,
                    "data_timestamp": data_ts,
                }
            )

    stmt = pg_insert(RiskPrediction).values(upsert_rows)
    stmt = stmt.on_conflict_do_update(
        constraint="uq_risk_predictions_cell_horizon",
        set_={
            "probability": stmt.excluded.probability,
            "level": stmt.excluded.level,
            "overall": stmt.excluded.overall,
            "model_version": stmt.excluded.model_version,
            "feature_schema_version": stmt.excluded.feature_schema_version,
            "data_timestamp": stmt.excluded.data_timestamp,
            "predicted_at": stmt.excluded.predicted_at,
        },
    )
    await session.execute(stmt)
    await session.flush()

    logger.info(
        "risk pipeline done as_of=%s: %d eligible, %d insufficient, %d rows",
        as_of,
        len(cells),
        len(insufficient),
        len(upsert_rows),
    )
    return RiskRunResult(
        as_of=as_of,
        cells_eligible=len(cells),
        cells_insufficient=len(insufficient),
        rows_upserted=len(upsert_rows),
    )
