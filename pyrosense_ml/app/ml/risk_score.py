"""Risk scoring — 3-horizon GRU risk signals + classification scoring.

Risk signals (per spec):
- Each GRU horizon model outputs one probability for its horizon.
- A horizon is HIGH when its probability >= its RISK_THRESHOLDS entry.
- Overall: 2+ HIGH -> "HIGH", exactly 1 HIGH -> "MODERATE", 0 HIGH -> "LOW".

These are RISK SIGNALS from fixed decision thresholds, NOT calibrated
probabilities — always describe them that way in UI/documentation.

Scaling and feature engineering are NOT this module's job (that is Phase 2C):
callers hand over an already-scaled (30, 17) sequence in RISK_FEATURES order.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from app.feature_schema import (
    CLASSIFIER_FEATURES,
    RISK_HORIZONS,
    RISK_THRESHOLDS,
    validate_classifier_features,
    validate_risk_sequence_shape,
)
from app.ml.model_loader import get_model


def score_risk(sequence: Any) -> dict:
    """Run all three GRU horizons on one (30, 17) sequence for ONE H3 cell.

    `sequence` must already be scaled (risk_scaler applied) and ordered by
    RISK_FEATURES. Schema-shape violations propagate untouched — never caught
    or hidden here.

    Returns:
        {
            "1day": {"score": <float>, "level": "HIGH"|"LOW"},
            "3day": {"score": <float>, "level": "HIGH"|"LOW"},
            "7day": {"score": <float>, "level": "HIGH"|"LOW"},
            "overall": "HIGH"|"MODERATE"|"LOW",
        }
    """
    validate_risk_sequence_shape(sequence)

    models = get_model().risk_models
    arr = np.asarray(sequence, dtype=np.float32)
    if arr.ndim == 2:  # (30, 17) -> (1, 30, 17): single-cell batch
        arr = arr[np.newaxis, ...]

    result: dict = {}
    high_count = 0
    for horizon in RISK_HORIZONS:
        prob = float(models[horizon].predict(arr, verbose=0)[0][0])
        level = "HIGH" if prob >= RISK_THRESHOLDS[horizon] else "LOW"
        if level == "HIGH":
            high_count += 1
        result[horizon] = {"score": round(prob, 6), "level": level}

    if high_count >= 2:
        result["overall"] = "HIGH"
    elif high_count == 1:
        result["overall"] = "MODERATE"
    else:
        result["overall"] = "LOW"
    return result


def classify(features: dict) -> dict:
    """Classification-side scoring: scale -> MLP -> predicted class + confidence.

    The caller passes a dict with exactly the CLASSIFIER_FEATURES keys; scaling
    happens here so no caller can forget it. Classes come back in
    CLASSIFIER_CLASSES (== label_encoder.classes_) order.

    Returns:
        {"predicted_class": str, "probabilities": dict[str, float], "confidence": float}
    """
    validate_classifier_features(features)

    models = get_model()
    values = [float(features[name]) for name in CLASSIFIER_FEATURES]
    scaled = models.classifier_scaler.transform(np.array([values], dtype=np.float64))
    probs = models.classifier.predict(scaled, verbose=0)[0]

    classes = [str(c) for c in models.label_encoder.classes_]
    prob_map = {cls: round(float(p), 6) for cls, p in zip(classes, probs)}
    predicted_class = classes[int(np.argmax(probs))]
    confidence = round(float(max(probs)), 6)
    return {
        "predicted_class": predicted_class,
        "probabilities": prob_map,
        "confidence": confidence,
    }
