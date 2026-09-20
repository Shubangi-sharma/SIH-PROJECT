"""ML layer tests — model loading, inference, risk scoring (Phase 2A models)."""

from __future__ import annotations

import numpy as np
import pytest

from app.feature_schema import (
    CLASSIFIER_CLASSES,
    CLASSIFIER_FEATURES,
    RISK_FEATURES,
    RISK_THRESHOLDS,
    SchemaViolation,
    validate_risk_sequence_shape,
)
from app.ml.inference import predict
from app.ml.model_loader import load_model
from app.ml.risk_score import classify, score_risk


@pytest.fixture(scope="module", autouse=True)
def _models():
    load_model()


def test_models_load_with_frozen_schema():
    from app.ml.model_loader import get_model

    m = get_model()
    assert [str(c) for c in m.label_encoder.classes_] == list(CLASSIFIER_CLASSES)
    assert m.classifier.input_shape[-1] == len(CLASSIFIER_FEATURES)
    assert sorted(m.risk_models) == ["1day", "3day", "7day"]


def test_predict_returns_all_classes(valid_features):
    result = predict(valid_features)
    assert result.predicted_class in CLASSIFIER_CLASSES
    assert set(result.probabilities) == set(CLASSIFIER_CLASSES)
    assert abs(sum(result.probabilities.values()) - 1.0) < 1e-3
    assert 0.0 <= result.confidence <= 1.0


def test_predict_rejects_leakage(valid_features):
    # Leakage columns are just unexpected keys now — the set-equality guard
    # rejects them with the same exception type as before.
    with pytest.raises(SchemaViolation):
        predict({**valid_features, "label": "Industrial"})


def test_predict_rejects_unknown_feature(valid_features):
    with pytest.raises(SchemaViolation, match="unexpected"):
        predict({**valid_features, "mystery_column": 1.0})


def test_predict_rejects_missing_feature(valid_features):
    partial = {k: v for k, v in valid_features.items() if k != "mean_frp"}
    with pytest.raises(SchemaViolation, match="missing"):
        predict(partial)


def test_predict_rejects_non_numeric(valid_features):
    with pytest.raises(SchemaViolation, match="non-numeric"):
        predict({**valid_features, "mean_frp": "high"})


def test_predict_deterministic(valid_features):
    a = predict(valid_features)
    b = predict(valid_features)
    assert a.predicted_class == b.predicted_class
    assert a.probabilities == b.probabilities


def test_classify_direct(valid_features):
    out = classify(valid_features)
    assert out["predicted_class"] in CLASSIFIER_CLASSES
    assert set(out["probabilities"]) == set(CLASSIFIER_CLASSES)


def test_score_risk_shape_and_levels():
    seq = np.zeros((30, len(RISK_FEATURES)), dtype="float32")
    result = score_risk(seq)
    assert set(result) == {"1day", "3day", "7day", "overall"}
    for h in ("1day", "3day", "7day"):
        assert 0.0 <= result[h]["score"] <= 1.0
        expected_level = "HIGH" if result[h]["score"] >= RISK_THRESHOLDS[h] else "LOW"
        assert result[h]["level"] == expected_level
    assert result["overall"] in ("HIGH", "MODERATE", "LOW")


def test_score_risk_overall_matches_levels():
    # Internal consistency: overall must follow the per-horizon levels by the
    # 2+/1/0 HIGH rule, regardless of what the live models score.
    result = score_risk(np.zeros((30, len(RISK_FEATURES)), dtype="float32"))
    highs = sum(1 for h in ("1day", "3day", "7day") if result[h]["level"] == "HIGH")
    expected = "HIGH" if highs >= 2 else ("MODERATE" if highs == 1 else "LOW")
    assert result["overall"] == expected


def test_score_risk_rejects_bad_shape():
    with pytest.raises(SchemaViolation, match="risk sequence shape mismatch"):
        score_risk(np.zeros((10, 17), dtype="float32"))


def test_validate_risk_sequence_shape_accepts_valid():
    validate_risk_sequence_shape(np.zeros((30, 17), dtype="float32"))
