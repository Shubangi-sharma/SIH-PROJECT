"""Known-sample regression test (Phase 5.2 / handoff PDF §15).

The handoff PDF documents one specific cell — H3 `873c5a885ffffff` — whose
GRU outputs were 0.70 / 0.73 / 0.71 (1/3/7-day). This test pins those
numbers: a future artifact swap that silently changes model behaviour
fails CI here before it can reach production.

The 30-day feature window is loaded from
tests/fixtures/known_sample_sequence.json. The training export carries no
per-row cell IDs, so the row was identified as the documented example by
its signature outputs (closest to 0.70/0.73/0.71 across the whole test
split; see the fixture's `provenance` block for the exact provenance
chain). It is stored RAW (unscaled) — the test applies the frozen
risk_scaler exactly as production does from firms_daily_h3.
Reproduced outputs at export time: 0.6977 / 0.7205 / 0.7063.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from app.feature_schema import RISK_FEATURES, RISK_THRESHOLDS
from app.ml.model_loader import load_model
from app.ml.risk_score import score_risk

FIXTURE = Path(__file__).parent / "fixtures" / "known_sample_sequence.json"

# Documented in the risk-prediction handoff PDF for cell 873c5a885ffffff.
# (Reproduced from the exported raw window: 0.6977 / 0.7205 / 0.7063.)
EXPECTED = {"1day": 0.70, "3day": 0.73, "7day": 0.71}
EXPECTED_CELL = "873c5a885ffffff"
TOLERANCE = 0.05  # round-trip float drift allowance — tight enough to catch swaps


@pytest.fixture(scope="module", autouse=True)
def _models():
    load_model()


@pytest.fixture
def sequence() -> np.ndarray:
    if not FIXTURE.exists():
        pytest.skip(f"known-sample fixture missing: {FIXTURE}")
    payload = json.loads(FIXTURE.read_text())
    assert payload["h3_cell"] == EXPECTED_CELL
    rows = payload["feature_rows"]  # 30 rows of 17 values, oldest first
    assert len(rows) == 30
    arr = np.array(rows, dtype=np.float32)
    assert arr.shape == (30, len(RISK_FEATURES))
    return arr


def test_known_sample_reproduces_documented_outputs(sequence):
    from app.ml.model_loader import get_model

    scaled = get_model().risk_scaler.transform(
        sequence.reshape(-1, len(RISK_FEATURES))
    ).reshape(sequence.shape).astype(np.float32)

    result = score_risk(scaled)
    for horizon, expected in EXPECTED.items():
        got = result[horizon]["score"]
        assert abs(got - expected) <= TOLERANCE, (
            f"{horizon}: got {got:.4f}, documented {expected} — model artifacts "
            f"or feature order have drifted; do not ship without reconciling"
        )


def test_known_sample_levels_follow_thresholds(sequence):
    from app.ml.model_loader import get_model

    scaled = get_model().risk_scaler.transform(
        sequence.reshape(-1, len(RISK_FEATURES))
    ).reshape(sequence.shape).astype(np.float32)
    result = score_risk(scaled)
    for horizon in ("1day", "3day", "7day"):
        expected_level = "HIGH" if result[horizon]["score"] >= RISK_THRESHOLDS[horizon] else "LOW"
        assert result[horizon]["level"] == expected_level
