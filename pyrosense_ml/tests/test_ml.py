"""ML layer tests — model loading, inference, risk scoring."""

from __future__ import annotations

import math

import pytest

from app.feature_schema import MODEL_CLASSES, SchemaViolation
from app.ml.inference import predict
from app.ml.risk_score import RISK_WEIGHTS, compute_risk_score, key_contributors
from app.ml.model_loader import load_model


@pytest.fixture(scope="module", autouse=True)
def _model():
    load_model()


def test_model_loads_with_frozen_schema():
    from app.ml.model_loader import get_model

    m = get_model()
    assert m.classes == list(MODEL_CLASSES)
    assert len(m.feature_names) == 36
    # Importances are aggregated per INPUT feature from the OHE-expanded
    # matrix (max over one-hot columns), so the sum is ≤ 1 but substantial.
    assert len(m.importances) == 36
    assert 0.5 < sum(m.importances.values()) <= 1.0 + 1e-9
    assert max(m.importances.values()) > 0.2  # a dominant driver exists


def test_predict_returns_all_classes(valid_features):
    result = predict(valid_features)
    assert result.predicted_class in MODEL_CLASSES
    assert set(result.probabilities) == set(MODEL_CLASSES)
    assert abs(sum(result.probabilities.values()) - 1.0) < 1e-3
    assert 0.0 <= result.confidence <= 1.0


def test_predict_rejects_leakage(valid_features):
    with pytest.raises(SchemaViolation, match="leakage"):
        predict({**valid_features, "label": "Industrial"})


def test_risk_score_bounds(valid_features):
    probs = predict(valid_features).probabilities
    risk = compute_risk_score(probs)
    assert 0.0 <= risk <= 100.0


def test_risk_score_weighting():
    # All-mass on Agricultural (w=0.3) vs Industrial (w=1.0)
    agri = compute_risk_score(
        {"Agricultural_Vegetation": 1.0, "Industrial": 0.0, "Mining_Extraction": 0.0,
         "Other_Persistent_Thermal_Source": 0.0}
    )
    ind = compute_risk_score(
        {"Agricultural_Vegetation": 0.0, "Industrial": 1.0, "Mining_Extraction": 0.0,
         "Other_Persistent_Thermal_Source": 0.0}
    )
    assert agri == 30.0
    assert ind == 100.0
    assert RISK_WEIGHTS["Mining_Extraction"] == 0.85
    assert RISK_WEIGHTS["Other_Persistent_Thermal_Source"] == 0.6


def test_key_contributors_shape(valid_features):
    result = predict(valid_features)
    drivers = key_contributors(result.features, top_k=5)
    assert 1 <= len(drivers) <= 5
    for d in drivers:
        assert {"feature", "value", "importance"} <= set(d)
        assert d["importance"] > 0


def test_predict_deterministic(valid_features):
    a = predict(valid_features)
    b = predict(valid_features)
    assert a.predicted_class == b.predicted_class
    assert a.probabilities == b.probabilities
