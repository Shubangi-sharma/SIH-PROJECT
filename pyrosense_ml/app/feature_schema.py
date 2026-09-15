"""Frozen feature schema — the SINGLE SOURCE OF TRUTH for the 36 model
features, their order, types, and valid values.

Any mismatch between input data and this schema is a hard error, by design.
The feature names and order below were extracted verbatim from
`FINAL_GRADIENT_BOOSTING_MODEL.pkl` (`preprocessor.feature_names_in_`) and MUST
NOT be edited by hand. Regenerate only by re-running
`scripts/inspect_model.py` against a retrained model and re-freezing.
"""

from __future__ import annotations

from typing import Final

# ── Versions ────────────────────────────────────────────────────────────────

SCHEMA_VERSION: Final[str] = "1.0.0"
MODEL_VERSION: Final[str] = "1.0.0"
DATASET_VERSION: Final[str] = "1.0.0"

# ── Feature columns (exact training order) ──────────────────────────────────

FEATURE_NAMES: Final[tuple[str, ...]] = (
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

assert len(FEATURE_NAMES) == 36, "frozen schema must stay at 36 features"

NUMERIC_FEATURES: Final[tuple[str, ...]] = tuple(
    n for n in FEATURE_NAMES if n not in ("dominant_land_cover",)
)
assert len(NUMERIC_FEATURES) == 35

CATEGORICAL_FEATURES: Final[tuple[str, ...]] = ("dominant_land_cover",)

# ── Valid categorical values (== OneHotEncoder.categories_) ─────────────────

VALID_LAND_COVER_CATEGORIES: Final[tuple[str, ...]] = (
    "bare",
    "built",
    "crops",
    "shrub_and_scrub",
    "trees",
    "water",
)

# ── Model output classes (exact order of predict_proba columns) ─────────────

MODEL_CLASSES: Final[tuple[str, ...]] = (
    "Agricultural_Vegetation",
    "Industrial",
    "Mining_Extraction",
    "Other_Persistent_Thermal_Source",
)

# ── Leakage guard ────────────────────────────────────────────────────────────
# Columns that must NEVER reach the model: they encode the answer (label) or
# post-hoc evidence scoring. A payload containing any of these is rejected
# with 422 before inference.

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

# ── Training medians (SimpleImputer(strategy="median").statistics_) ─────────
# Used by risk_score.key_contributors() as the "typical value" reference point
# when measuring how much a hotspot's feature deviates from the norm.

TRAINING_MEDIANS: Final[dict[str, float]] = {
    "total_detections": 35.0,
    "unique_days": 19.0,
    "unique_months": 7.0,
    "mean_FRP": 4.374786295793759,
    "max_FRP": 13.17,
    "active_duration_days": 610.5,
    "distance_to_industrial_km": 22.091405685132578,
    "distance_to_power_km": 95.21228868684153,
    "distance_to_mining_km": 58.48587326195418,
    "distance_to_fuel_storage_km": 34.49757235966696,
    "distance_to_agriculture_km": 25.01299095293728,
    "distance_to_transport_km": 14.343575002085625,
    "land_cover_observations": 8.0,
    "lc_water_ratio": 0.0,
    "lc_trees_ratio": 0.0,
    "lc_grass_ratio": 0.0,
    "lc_flooded_vegetation_ratio": 0.0,
    "lc_crops_ratio": 0.3333333333333333,
    "lc_shrub_and_scrub_ratio": 0.0,
    "lc_built_ratio": 0.0,
    "lc_bare_ratio": 0.0,
    "mean_temperature": 27.261973063151043,
    "max_temperature": 35.069122314453125,
    "min_temperature": 22.685501098632812,
    "mean_wind_speed": 2.2160084176783905,
    "max_wind_speed": 3.4167157165990756,
    "mean_dewpoint": 12.4031982421875,
    "mean_precipitation": 1.0184418650059302e-05,
    "total_precipitation": 9.37602778492419e-05,
    "mean_solar_radiation": 17412421.908653848,
    "weather_observations": 8.0,
    "first_detection_year": 2024.0,
    "first_detection_month": 2.0,
    "last_detection_year": 2025.0,
    "last_detection_month": 12.0,
}

assert set(TRAINING_MEDIANS) == set(NUMERIC_FEATURES)


class SchemaViolation(ValueError):
    """Raised when input data does not match the frozen feature schema."""


def validate_features(
    features: dict[str, object],
    *,
    strict: bool = True,
) -> dict[str, object]:
    """Validate a feature mapping against the frozen schema.

    - Rejects leakage columns outright (SchemaViolation).
    - Rejects unknown columns not in FEATURE_NAMES.
    - Rejects missing required features (strict mode; default).
    - Checks types: numeric features must be int/float, the categorical must
      be one of VALID_LAND_COVER_CATEGORIES.

    Returns the validated, coerced mapping (floats for numeric features).
    """
    leaky = LEAKAGE_COLUMNS.intersection(features)
    if leaky:
        raise SchemaViolation(
            f"payload contains leakage column(s) {sorted(leaky)} — these must "
            "never be provided as model input"
        )

    unknown = set(features) - set(FEATURE_NAMES)
    if unknown:
        raise SchemaViolation(f"unknown feature column(s): {sorted(unknown)}")

    missing = set(FEATURE_NAMES) - set(features)
    if missing and strict:
        raise SchemaViolation(f"missing required feature(s): {sorted(missing)}")

    validated: dict[str, object] = {}
    for name in FEATURE_NAMES:
        if name not in features:
            continue  # strict=False: leave it absent; imputer will handle NaN
        value = features[name]
        if name in CATEGORICAL_FEATURES:
            if not isinstance(value, str) or value not in VALID_LAND_COVER_CATEGORIES:
                raise SchemaViolation(
                    f"{name}: expected one of {list(VALID_LAND_COVER_CATEGORIES)}, got {value!r}"
                )
            validated[name] = value
        else:
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise SchemaViolation(
                    f"{name}: expected a number, got {type(value).__name__} ({value!r})"
                )
            import math

            if math.isnan(float(value)) or math.isinf(float(value)):
                raise SchemaViolation(f"{name}: NaN/Infinity is not a valid feature value")
            validated[name] = float(value)

    return validated
