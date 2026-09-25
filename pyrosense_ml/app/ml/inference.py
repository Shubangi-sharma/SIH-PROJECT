"""Inference — the ONLY path through the classifier.

Contract (Phase 2A + decision (b), docs/decisions-and-faq.md):
- Accepts a feature mapping with exactly the 43 frozen CLASSIFIER_FEATURES
  (model_version="new", default) or the 36 CLASSIFIER_FEATURES_OLD including
  the categorical dominant_land_cover (model_version="old").
- validate_*_features() guards the schema (set equality); non-numeric values
  raise SchemaViolation.
- Scaling happens inside classify() (the scaler is an inference concern, not
  the caller's).
- Returns a PredictionResult; never raw model output. classifier_model_used
  names the model that answered ("mlp_v1" | "gbm_v1").
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone

from app.feature_schema import (
    CLASSIFIER_MODEL_VERSION,
    CLASSIFIER_USED_NEW,
    DATASET_VERSION,
    SCHEMA_VERSION,
    SchemaViolation,
    resolve_classifier_version,
    validate_classifier_features,
    validate_classifier_features_old,
)
from app.ml.model_loader import get_model  # noqa: F401  (re-exported for callers)
from app.ml.risk_score import classify

logger = logging.getLogger("pyrosense.ml.inference")


@dataclass
class PredictionResult:
    predicted_class: str
    probabilities: dict[str, float]
    confidence: float
    features: dict[str, float | str]
    classifier_model_used: str = CLASSIFIER_USED_NEW
    model_version: str = CLASSIFIER_MODEL_VERSION
    dataset_version: str = DATASET_VERSION
    feature_schema_version: str = SCHEMA_VERSION
    prediction_timestamp: datetime = field(
        default_factory=lambda: datetime.now(timezone.utc)
    )

    def to_dict(self) -> dict:
        return {
            "class": self.predicted_class,
            "probabilities": self.probabilities,
            "confidence": self.confidence,
            "features": self.features,
            "prediction_timestamp": self.prediction_timestamp.isoformat(),
        }


def predict(features: dict[str, object], model_version: str | None = None) -> PredictionResult:
    """Validate + run the requested classifier on one hotspot's feature payload.

    model_version: "new" (default, MLP) or "old" (legacy GBM) — see
    docs/decisions-and-faq.md. Raises SchemaViolation on any schema problem
    (missing/unknown features, non-numeric values, bad version).
    """
    version = resolve_classifier_version(model_version)
    if version == "old":
        validate_classifier_features_old(features)
    else:
        validate_classifier_features(features)

    try:
        result = classify(features, model_version=version)
    except (TypeError, ValueError) as exc:
        raise SchemaViolation(f"non-numeric feature value: {exc}") from exc

    logger.debug(
        "classified via %s: %s (confidence=%.4f)",
        result["classifier_model_used"],
        result["predicted_class"],
        result["confidence"],
    )
    return PredictionResult(
        predicted_class=result["predicted_class"],
        probabilities=result["probabilities"],
        confidence=result["confidence"],
        features=dict(features),
        classifier_model_used=result["classifier_model_used"],
    )
