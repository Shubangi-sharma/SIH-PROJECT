"""Risk scoring — 3-horizon GRU risk signals + version-routed classification.

Risk signals (per spec):
- Each GRU horizon model outputs one probability for its horizon.
- A horizon is HIGH when its probability >= its RISK_THRESHOLDS entry.
- Overall: 2+ HIGH -> "HIGH", exactly 1 HIGH -> "MODERATE", 0 HIGH -> "LOW".

These are RISK SIGNALS from fixed decision thresholds, NOT calibrated
probabilities — always describe them that way in UI/documentation.

Scaling and feature engineering are NOT this module's job (that is Phase 2C):
callers hand over an already-scaled (30, 17) sequence in RISK_FEATURES order.

Classification is version-routed per docs/CLASSIFIER_DECISION.md decision (b):
- model_version="new" (default) -> MLP stack (scaler inside this module).
- model_version="old" -> Gradient Boosting pipeline (expects a raw 36-column
  DataFrame; its own preprocessing — imputation + one-hot — lives inside the
  pickle). The label spaces differ (5 MLP classes vs 4 GBM classes), so the
  returned probabilities are always keyed by whichever model answered, and
  `classifier_model_used` names it explicitly ("mlp_v1" / "gbm_v1").

NOTE: the legacy GBM-era weighted-probability-sum risk formula
(100·Σ wᵢ·Pᵢ) was removed in Phase 2A — it modeled classifier severity, not
temporal fire risk, and the GRU score_risk() below is its replacement. It is
intentionally not preserved anywhere, not even as a comment.
"""

from __future__ import annotations

import logging
import time
from typing import Any

import numpy as np

from app.feature_schema import (
    CLASSIFIER_CLASSES,
    CLASSIFIER_CLASSES_OLD,
    CLASSIFIER_FEATURES,
    CLASSIFIER_FEATURES_OLD,
    CLASSIFIER_USED_NEW,
    CLASSIFIER_USED_OLD,
    RISK_HORIZONS,
    RISK_THRESHOLDS,
    SchemaViolation,
    resolve_classifier_version,
    validate_classifier_features,
    validate_classifier_features_old,
    validate_risk_sequence_shape,
)
from app.ml.model_loader import get_model

logger = logging.getLogger("pyrosense.ml.risk_score")


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
    started = time.perf_counter()
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

    logger.info(
        "score_risk: model=gru_risk_v1 sequence_shape=%s overall=%s "
        "levels=%s latency_ms=%.1f",
        tuple(arr.shape),
        result["overall"],
        {h: result[h]["level"] for h in RISK_HORIZONS},
        (time.perf_counter() - started) * 1000.0,
    )
    return result


def _classify_new(features: dict) -> dict:
    """MLP path: scale (scaler is an inference concern) -> predict."""
    models = get_model()
    values = [float(features[name]) for name in CLASSIFIER_FEATURES]
    scaled = models.classifier_scaler.transform(np.array([values], dtype=np.float64))
    probs = models.classifier.predict(scaled, verbose=0)[0]

    classes = [str(c) for c in models.label_encoder.classes_]
    prob_map = {cls: round(float(p), 6) for cls, p in zip(classes, probs)}
    predicted_class = classes[int(np.argmax(probs))]
    return {
        "predicted_class": predicted_class,
        "probabilities": prob_map,
        "confidence": round(float(max(probs)), 6),
        "classifier_model_used": CLASSIFIER_USED_NEW,
    }


def _classify_old(features: dict) -> dict:
    """GBM path: raw 36-column DataFrame (pipeline owns preprocessing)."""
    import pandas as pd

    models = get_model()
    if models.gbm_pipeline is None:
        raise RuntimeError(
            "model_version='old' requested but the legacy GBM pipeline is not "
            "loaded (see docs/CLASSIFIER_DECISION.md)"
        )
    frame = pd.DataFrame(
        [[features[name] for name in CLASSIFIER_FEATURES_OLD]],
        columns=list(CLASSIFIER_FEATURES_OLD),
    )
    probs = models.gbm_pipeline.predict_proba(frame)[0]

    prob_map = {
        cls: round(float(p), 6) for cls, p in zip(CLASSIFIER_CLASSES_OLD, probs)
    }
    predicted_class = CLASSIFIER_CLASSES_OLD[int(np.argmax(probs))]
    return {
        "predicted_class": predicted_class,
        "probabilities": prob_map,
        "confidence": round(float(max(probs)), 6),
        "classifier_model_used": CLASSIFIER_USED_OLD,
    }


def classify(features: dict, model_version: str | None = None) -> dict:
    """Classification-side scoring, routed by model_version (decision (b)).

    The caller passes a dict with exactly the requested model's feature keys
    (43 for "new", 36 incl. the categorical dominant_land_cover for "old").
    Scaling for the MLP happens here so no caller can forget it.

    Returns:
        {
            "predicted_class": str,
            "probabilities": dict[str, float],
            "confidence": float,
            "classifier_model_used": "mlp_v1" | "gbm_v1",
        }
    """
    version = resolve_classifier_version(model_version)

    if version == "old":
        validate_classifier_features_old(features)
    else:
        validate_classifier_features(features)

    started = time.perf_counter()
    try:
        result = _classify_old(features) if version == "old" else _classify_new(features)
    except (TypeError, ValueError) as exc:
        # "non-numeric feature value" is the historical message contract that
        # tests and API consumers match on — keep it for both model versions.
        raise SchemaViolation(f"non-numeric feature value: {exc}") from exc

    logger.info(
        "classify: model=%s feature_count=%d predicted=%s confidence=%.4f "
        "latency_ms=%.1f",
        result["classifier_model_used"],
        len(features),
        result["predicted_class"],
        result["confidence"],
        (time.perf_counter() - started) * 1000.0,
    )
    return result
