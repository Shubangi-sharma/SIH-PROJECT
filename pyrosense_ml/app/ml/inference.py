"""Inference — the ONLY path through the model.

Contract:
- Accepts a validated 36-feature mapping.
- Builds a single-row DataFrame with the exact frozen column order.
- Calls predict() + predict_proba().
- Returns a PredictionResult dataclass; never the raw pipeline output.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone

import pandas as pd

from app.feature_schema import (
    FEATURE_NAMES,
    MODEL_CLASSES,
    SchemaViolation,
    validate_features,
)
from app.ml.model_loader import get_model

logger = logging.getLogger("pyrosense.ml.inference")


@dataclass
class PredictionResult:
    predicted_class: str
    probabilities: dict[str, float]
    confidence: float
    features: dict[str, float | str]
    model_version: str = ""
    dataset_version: str = ""
    feature_schema_version: str = ""
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
    """Validate + run inference on one hotspot's 36 features.

    Raises SchemaViolation on any schema problem (leakage columns, unknown
    columns, missing features, bad types/values).
    """
    validated = validate_features(features, strict=True)

    model = get_model()
    row = {name: validated.get(name) for name in FEATURE_NAMES}
    frame = pd.DataFrame([row], columns=list(FEATURE_NAMES))

    probs = model.pipeline.predict_proba(frame)[0]
    pred_label = str(model.pipeline.predict(frame)[0])

    prob_map = {cls: round(float(p), 6) for cls, p in zip(model.classes, probs)}

    return PredictionResult(
        predicted_class=pred_label,
        probabilities=prob_map,
        confidence=round(float(max(probs)), 6),
        features=dict(validated),
        model_version=model.model_version,
        dataset_version=model.dataset_version,
        feature_schema_version=model.feature_schema_version,
    )
