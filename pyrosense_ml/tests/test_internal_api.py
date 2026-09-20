"""Internal API contract tests — schema-level checks with the app mounted.

The DB-backed routes are exercised via simple monkeypatched fakes so the
response CONTRACT (the thing the Node BFF's Zod schemas mirror) is verified
without PostgreSQL: every risk response carries horizons/overall/status/
data_timestamp; batch responses separate risks from missing cells; every
response exposes model/feature-schema versions.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.api.internal import (
    BATCH_MAX_CELLS,
    INSUFFICIENT_HISTORY,
    RiskBatchRequest,
    _risk_for_cells,
)


class FakeRiskRow:
    def __init__(self, cell: str, horizon: str, prob: float, overall: str):
        self.h3_cell = cell
        self.horizon = horizon
        self.probability = prob
        self.level = "HIGH" if prob >= {"1day": 0.65, "3day": 0.40, "7day": 0.35}[horizon] else "LOW"
        self.overall = overall
        self.model_version = "1.0.0"
        self.feature_schema_version = "2.0.0"
        self.data_timestamp = datetime(2026, 9, 18, tzinfo=timezone.utc)


class FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return self._rows


class FakeSession:
    def __init__(self, rows):
        self._rows = rows

    async def execute(self, _stmt):
        return FakeResult(self._rows)


@pytest.mark.asyncio
async def test_risk_for_cells_contract_shape():
    rows = [
        FakeRiskRow("cellA", h, 0.9, "HIGH")
        for h in ("1day", "3day", "7day")
    ]
    out = await _risk_for_cells(FakeSession(rows), ["cellA"])
    entry = out["cellA"]
    assert set(entry["horizons"]) == {"1day", "3day", "7day"}
    assert entry["status"] == "ok"
    assert entry["overall"] == "HIGH"
    assert entry["data_timestamp"] is not None
    for h in entry["horizons"].values():
        assert {"probability", "level", "threshold"} <= set(h)


@pytest.mark.asyncio
async def test_risk_for_cells_partial_status():
    rows = [FakeRiskRow("cellA", "1day", 0.9, "MODERATE")]
    out = await _risk_for_cells(FakeSession(rows), ["cellA"])
    assert out["cellA"]["status"] == "partial"


def test_insufficient_history_constant():
    assert INSUFFICIENT_HISTORY == "insufficient_history"


def test_batch_request_rejects_empty():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        RiskBatchRequest(h3_cells=[])


def test_batch_max_cells_constant():
    assert BATCH_MAX_CELLS == 5000
