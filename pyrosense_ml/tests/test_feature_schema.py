"""Schema guard tests — the frozen 36-feature contract."""

from __future__ import annotations

import pytest

from app.feature_schema import (
    FEATURE_NAMES,
    LEAKAGE_COLUMNS,
    MODEL_CLASSES,
    NUMERIC_FEATURES,
    VALID_LAND_COVER_CATEGORIES,
    SchemaViolation,
    validate_features,
)


def test_feature_count_and_names():
    assert len(FEATURE_NAMES) == 36
    assert len(NUMERIC_FEATURES) == 35
    assert "dominant_land_cover" in FEATURE_NAMES
    assert "total_detections" == FEATURE_NAMES[0]
    assert "last_detection_month" == FEATURE_NAMES[-1]


def test_model_classes_frozen():
    assert MODEL_CLASSES == (
        "Agricultural_Vegetation",
        "Industrial",
        "Mining_Extraction",
        "Other_Persistent_Thermal_Source",
    )


def test_valid_payload_passes(valid_features):
    out = validate_features(valid_features)
    assert set(out) == set(FEATURE_NAMES)
    assert out["total_detections"] == 42.0


def test_leakage_columns_rejected(valid_features):
    for col in ("label", "evidence_score", "risk_score", "confidence"):
        payload = {**valid_features, col: 1.0}
        with pytest.raises(SchemaViolation, match="leakage"):
            validate_features(payload)


def test_unknown_column_rejected(valid_features):
    payload = {**valid_features, "mystery_column": 1}
    with pytest.raises(SchemaViolation, match="unknown feature"):
        validate_features(payload)


def test_missing_required_rejected():
    with pytest.raises(SchemaViolation, match="missing required feature"):
        validate_features({"total_detections": 5})


def test_wrong_type_rejected(valid_features):
    payload = {**valid_features, "mean_FRP": "high"}
    with pytest.raises(SchemaViolation, match="mean_FRP"):
        validate_features(payload)


def test_bool_is_not_numeric(valid_features):
    payload = {**valid_features, "mean_FRP": True}
    with pytest.raises(SchemaViolation, match="mean_FRP"):
        validate_features(payload)


def test_nan_rejected(valid_features):
    payload = {**valid_features, "max_FRP": float("nan")}
    with pytest.raises(SchemaViolation, match="NaN"):
        validate_features(payload)


def test_invalid_land_cover_rejected(valid_features):
    payload = {**valid_features, "dominant_land_cover": "savanna"}
    with pytest.raises(SchemaViolation, match="dominant_land_cover"):
        validate_features(payload)


def test_all_land_cover_categories_accepted(valid_features):
    for cat in VALID_LAND_COVER_CATEGORIES:
        payload = {**valid_features, "dominant_land_cover": cat}
        assert validate_features(payload)["dominant_land_cover"] == cat


def test_non_strict_allows_missing(valid_features):
    partial = {k: v for k, v in valid_features.items() if k != "max_FRP"}
    out = validate_features(partial, strict=False)
    assert "max_FRP" not in out
