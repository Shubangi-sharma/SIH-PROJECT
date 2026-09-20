"""
Frozen feature schema — the SINGLE SOURCE OF TRUTH for both models'
input features, their order, and versions.

CLASSIFIER_FEATURES and RISK_FEATURES below were extracted verbatim
from data_science/classification/artifacts/classifier_features.pkl and
data_science/risk_prediction/artifacts/feature_names.pkl respectively.
Do not hand-edit these tuples. Regenerate only via
pyrosense_ml/scripts/_extract_feature_lists.py if the underlying
pickles change.

NOTE: there are three independent schemas because there are three
independent model families: the NEW MLP classifier (43 features), the OLD
Gradient Boosting classifier (36 features, kept as the "old" model_version
per docs/CLASSIFIER_DECISION.md — decision (b) keep-alongside), and the
3-horizon GRU risk predictor (30x17 sequences).
"""

from __future__ import annotations

from typing import Final

SCHEMA_VERSION: Final[str] = "2.0.0"
CLASSIFIER_MODEL_VERSION: Final[str] = "1.0.0"
RISK_MODEL_VERSION: Final[str] = "1.0.0"
DATASET_VERSION: Final[str] = "1.0.0"

# --- pasted verbatim from _extract_feature_lists.py output (step C1) ---

CLASSIFIER_FEATURES: Final[tuple[str, ...]] = (
    "unique_h3_cells",
    "total_fire_detections",
    "unique_fire_days",
    "mean_frp",
    "max_frp",
    "mean_brightness",
    "max_brightness",
    "temporal_span_days",
    "active_months",
    "distance_to_industrial_km",
    "distance_to_power_km",
    "distance_to_mining_km",
    "distance_to_fuel_km",
    "distance_to_transport_km",
    "distance_to_agriculture_km",
    "near_industrial_500m",
    "near_power_1km",
    "near_mining_5km",
    "near_fuel_2km",
    "near_transport_1km",
    "near_agriculture_1km",
    "lc_bare_ratio",
    "lc_built_ratio",
    "lc_crops_ratio",
    "lc_flooded_vegetation_ratio",
    "lc_grass_ratio",
    "lc_shrub_and_scrub_ratio",
    "lc_snow_and_ice_ratio",
    "lc_trees_ratio",
    "lc_water_ratio",
    "lc_vegetation_ratio",
    "mean_temperature_c",
    "max_temperature_c",
    "mean_dewpoint_c",
    "mean_relative_humidity",
    "min_relative_humidity",
    "mean_wind_speed_ms",
    "max_wind_speed_ms",
    "total_precipitation",
    "mean_precipitation",
    "mean_ssrd",
    "max_ssrd",
    "weather_observation_count",
)

# ── Classifier feature groups ────────────────────────────────────────────────
# Boolean proximity flags (train-time 0/1); every other classifier feature is
# numeric. The lc_* ratios are numeric features bounded to [0, 1].

CLASSIFIER_BOOLEAN_FEATURES: Final[tuple[str, ...]] = (
    "near_industrial_500m",
    "near_power_1km",
    "near_mining_5km",
    "near_fuel_2km",
    "near_transport_1km",
    "near_agriculture_1km",
)

# ── OLD classifier schema (Gradient Boosting, kept per decision (b)) ─────────
# Extracted verbatim from the pre-Phase-2A feature_schema.py (git 46cba71); the
# names come from FINAL_GRADIENT_BOOSTING_MODEL.pkl's
# preprocessor.feature_names_in_. Kept because docs/CLASSIFIER_DECISION.md
# decision (b) keeps the GBM callable via model_version="old". Do not hand-edit.

CLASSIFIER_FEATURES_OLD: Final[tuple[str, ...]] = (
    "total_detections",
    "unique_days",
    "unique_months",
    "mean_FRP",
    "max_FRP",
    "active_duration_days",
    "distance_to_industrial_km",
    "distance_to_power_km",
    "distance_to_mining_km",
    "distance_to_fuel_storage_km",
    "distance_to_agriculture_km",
    "distance_to_transport_km",
    "dominant_land_cover",
    "land_cover_observations",
    "lc_water_ratio",
    "lc_trees_ratio",
    "lc_grass_ratio",
    "lc_flooded_vegetation_ratio",
    "lc_crops_ratio",
    "lc_shrub_and_scrub_ratio",
    "lc_built_ratio",
    "lc_bare_ratio",
    "mean_temperature",
    "max_temperature",
    "min_temperature",
    "mean_wind_speed",
    "max_wind_speed",
    "mean_dewpoint",
    "mean_precipitation",
    "total_precipitation",
    "mean_solar_radiation",
    "weather_observations",
    "first_detection_year",
    "first_detection_month",
    "last_detection_year",
    "last_detection_month",
)

assert len(CLASSIFIER_FEATURES_OLD) == 36, "frozen old classifier schema must stay at 36 features"

# The one categorical column in the old schema (OneHotEncoder input).
CLASSIFIER_CATEGORICAL_FEATURES_OLD: Final[tuple[str, ...]] = ("dominant_land_cover",)

VALID_LAND_COVER_CATEGORIES_OLD: Final[tuple[str, ...]] = (
    "bare",
    "built",
    "crops",
    "shrub_and_scrub",
    "trees",
    "water",
)

# ── Past/model labels surfaced to API consumers ────────────────────────────
# classifier_model_used values, so downstream never has to guess which model
# answered (see docs/CLASSIFIER_DECISION.md).

CLASSIFIER_USED_NEW: Final[str] = "mlp_v1"
CLASSIFIER_USED_OLD: Final[str] = "gbm_v1"
CLASSIFIER_MODEL_VERSIONS: Final[tuple[str, ...]] = ("new", "old")

CLASSIFIER_NUMERIC_FEATURES: Final[tuple[str, ...]] = tuple(
    n for n in CLASSIFIER_FEATURES if n not in CLASSIFIER_BOOLEAN_FEATURES
)

assert len(CLASSIFIER_FEATURES) == 43, "frozen classifier schema must stay at 43 features"
assert len(CLASSIFIER_NUMERIC_FEATURES) == 37

# Documented fallback priors for live feature engineering when a source is
# unavailable: fire/FRP/brightness/proximity/LC features fall back to 0.0
# (see features/engineer.py provenance + warnings). Weather gaps are handled
# per-feature in engineer.py. NOT real training medians — replace with values
# extracted from the training pipeline if/when they are published.

CLASSIFIER_TRAINING_MEDIANS: Final[dict[str, float]] = {
    name: 0.0 for name in CLASSIFIER_FEATURES
}

# --- pasted verbatim from label_encoder.pkl .classes_ (step C3) ---

CLASSIFIER_CLASSES: Final[tuple[str, ...]] = (
    "Agricultural",
    "Forest_Vegetation",
    "Industrial",
    "Infrastructure_Energy",
    "Mining",
)

# --- OLD GBM's predict_proba column order (from the pickle's classes_) ---

CLASSIFIER_CLASSES_OLD: Final[tuple[str, ...]] = (
    "Agricultural_Vegetation",
    "Industrial",
    "Mining_Extraction",
    "Other_Persistent_Thermal_Source",
)

# --- pasted verbatim from _extract_feature_lists.py output (step C1) ---

RISK_FEATURES: Final[tuple[str, ...]] = (
    "fire_count",
    "mean_frp",
    "max_frp",
    "mean_brightness",
    "max_brightness",
    "mean_temperature_c",
    "min_temperature_c",
    "max_temperature_c",
    "mean_dewpoint_c",
    "mean_wind_speed_ms",
    "max_wind_speed_ms",
    "mean_relative_humidity",
    "min_relative_humidity",
    "total_precipitation",
    "mean_precipitation",
    "mean_ssrd",
    "max_ssrd",
)

RISK_SEQUENCE_LENGTH: Final[int] = 30
RISK_HORIZONS: Final[tuple[str, ...]] = ("1day", "3day", "7day")
RISK_THRESHOLDS: Final[dict[str, float]] = {
    "1day": 0.65,
    "3day": 0.40,
    "7day": 0.35,
}


# ── Leakage guard ────────────────────────────────────────────────────────────
# Columns that must NEVER reach a model: they encode the answer (label) or
# post-hoc scoring. A payload containing any of these is rejected before
# inference.

LEAKAGE_COLUMNS: Final[frozenset[str]] = frozenset(
    {
        "label",
        "target",
        "class",
        "classification",
        "y_true",
        "evidence_score",
        "risk_score",
        "confidence",
        "prediction",
        "predicted_class",
        "source",
    }
)


class SchemaViolation(Exception):
    """Raised when input features don't match a frozen schema."""


def validate_classifier_features(feature_dict: dict) -> None:
    expected = set(CLASSIFIER_FEATURES)
    actual = set(feature_dict.keys())
    if actual != expected:
        missing = expected - actual
        extra = actual - expected
        raise SchemaViolation(
            f"classifier feature mismatch: missing={sorted(missing)}, "
            f"unexpected={sorted(extra)}"
        )


def validate_classifier_features_old(feature_dict: dict) -> None:
    """Same fail-hard set-equality guard, for the OLD 36-feature GBM schema."""
    expected = set(CLASSIFIER_FEATURES_OLD)
    actual = set(feature_dict.keys())
    if actual != expected:
        missing = expected - actual
        extra = actual - expected
        raise SchemaViolation(
            f"old-classifier feature mismatch: missing={sorted(missing)}, "
            f"unexpected={sorted(extra)}"
        )
    # Categorical column must carry a value the GBM's OneHotEncoder was fitted
    # on — anything else means the pickle was retrained or the payload is wrong.
    for col in CLASSIFIER_CATEGORICAL_FEATURES_OLD:
        value = feature_dict.get(col)
        if not isinstance(value, str) or value not in VALID_LAND_COVER_CATEGORIES_OLD:
            raise SchemaViolation(
                f"old-classifier categorical feature {col!r} must be one of "
                f"{list(VALID_LAND_COVER_CATEGORIES_OLD)}, got {value!r}"
            )


def resolve_classifier_version(model_version: str | None) -> str:
    """Normalize a requested classifier version; None → default ("new").

    Raises SchemaViolation on anything other than "new"/"old" so bad values
    surface as the same exception type as schema problems.
    """
    if model_version is None:
        return "new"
    if model_version not in CLASSIFIER_MODEL_VERSIONS:
        raise SchemaViolation(
            f"model_version must be one of {list(CLASSIFIER_MODEL_VERSIONS)}, "
            f"got {model_version!r}"
        )
    return model_version


def validate_risk_sequence_shape(sequence) -> None:
    # sequence is expected to be array-like with shape (30, 17)
    shape = getattr(sequence, "shape", None)
    if shape is None or tuple(shape) != (RISK_SEQUENCE_LENGTH, len(RISK_FEATURES)):
        raise SchemaViolation(
            f"risk sequence shape mismatch: expected "
            f"({RISK_SEQUENCE_LENGTH}, {len(RISK_FEATURES)}), got {shape}"
        )
