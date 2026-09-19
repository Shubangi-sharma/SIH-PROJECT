"""Schema guard tests — the frozen dual contract (43 classifier / 17 risk)."""

from __future__ import annotations

import numpy as np
import pytest

from app.feature_schema import (
    CLASSIFIER_CLASSES,
    CLASSIFIER_FEATURES,
    CLASSIFIER_NUMERIC_FEATURES,
    RISK_FEATURES,
    RISK_SEQUENCE_LENGTH,
    RISK_THRESHOLDS,
    SchemaViolation,
    validate_classifier_features,
    validate_risk_sequence_shape,
)


def test_classifier_feature_count_and_names():
    assert len(CLASSIFIER_FEATURES) == 43
    assert len(CLASSIFIER_NUMERIC_FEATURES) == 37
    assert CLASSIFIER_FEATURES[0] == "unique_h3_cells"
    assert CLASSIFIER_FEATURES[-1] == "weather_observation_count"


def test_risk_schema_frozen():
    assert len(RISK_FEATURES) == 17
    assert RISK_SEQUENCE_LENGTH == 30
    assert RISK_THRESHOLDS == {"1day": 0.65, "3day": 0.40, "7day": 0.35}


def test_classifier_classes_frozen():
    assert CLASSIFIER_CLASSES == (
        "Agricultural",
        "Forest_Vegetation",
        "Industrial",
        "Infrastructure_Energy",
        "Mining",
    )


def test_valid_payload_passes(valid_features):
    validate_classifier_features(valid_features)  # must not raise


def test_missing_feature_rejected(valid_features):
    partial = {k: v for k, v in valid_features.items() if k != "mean_frp"}
    with pytest.raises(SchemaViolation, match="missing"):
        validate_classifier_features(partial)


def test_unknown_feature_rejected(valid_features):
    with pytest.raises(SchemaViolation, match="unexpected"):
        validate_classifier_features({**valid_features, "mystery_column": 1.0})


def test_leakage_columns_rejected(valid_features):
    for col in ("label", "risk_score", "confidence"):
        with pytest.raises(SchemaViolation):
            validate_classifier_features({**valid_features, col: 1.0})


def test_risk_shape_accepts_valid():
    validate_risk_sequence_shape(np.zeros((30, 17), dtype="float32"))


def test_risk_shape_rejects_wrong_shape():
    with pytest.raises(SchemaViolation, match="risk sequence shape mismatch"):
        validate_risk_sequence_shape(np.zeros((10, 17)))
    with pytest.raises(SchemaViolation, match="risk sequence shape mismatch"):
        validate_risk_sequence_shape(np.zeros((30, 16)))
