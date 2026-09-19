"""Inference — the ONLY path through the classifier.

Contract (Phase 2A):
- Accepts a feature mapping with exactly the 43 frozen CLASSIFIER_FEATURES.
- validate_classifier_features() guards the schema (set equality); non-numeric
  values raise SchemaViolation.
- Scaling happens inside classify() (the scaler is an inference concern, not
  the caller's).
- Returns a PredictionResult; never raw model output.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone

from app.feature_schema import (
    CLASSIFIER_MODEL_VERSION,
    DATASET_VERSION,
    SCHEMA_VERSION,
    SchemaViolation,
    validate_classifier_features,
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


def predict(features: dict[str, object]) -> PredictionResult:
    """Validate + run the classifier on one hotspot's 43-feature payload.

    Raises SchemaViolation on any schema problem (missing/unknown features,
    non-numeric values).
    """
    validate_classifier_features(features)

    try:
        result = classify(features)
    except (TypeError, ValueError) as exc:
        raise SchemaViolation(f"non-numeric feature value: {exc}") from exc

    logger.debug(
        "classified: %s (confidence=%.4f)", result["predicted_class"], result["confidence"]
    )
    return PredictionResult(
        predicted_class=result["predicted_class"],
        probabilities=result["probabilities"],
        confidence=result["confidence"],
        features=dict(features),
    )
