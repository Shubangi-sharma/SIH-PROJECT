"""Model loader — loads MLP classifier + OLD GBM + 3 GRU risk models ONCE at startup.

Contract (Phase 2A + decision (b), see docs/CLASSIFIER_DECISION.md):
- Seven artifacts load together into ONE cached LoadedModels object: the Keras
  classifier, its scaler, its label encoder, the OLD Gradient Boosting
  pipeline (kept per decision (b) — callable via model_version="old"), the
  three horizon GRU models, and the risk scaler.
- Everything is validated against app.feature_schema at load time. Any
  mismatch is a hard startup failure — a ML service that cannot prove its
  models match the frozen schema must not serve.
- get_model() returns the cached object; models are never re-read from disk.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from typing import Any

from app.feature_schema import (
    CLASSIFIER_CLASSES,
    CLASSIFIER_CLASSES_OLD,
    CLASSIFIER_FEATURES,
    CLASSIFIER_FEATURES_OLD,
    RISK_FEATURES,
    RISK_SEQUENCE_LENGTH,
)

logger = logging.getLogger("pyrosense.ml.model_loader")

# Paths are built relative to the REPO ROOT (three levels above this file:
# app/ml/model_loader.py -> pyrosense_ml -> repo root) so startup works
# regardless of the process's working directory.
_REPO_ROOT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), os.pardir, os.pardir, os.pardir)
)
_DATA_SCIENCE = os.path.join(_REPO_ROOT, "data_science")

CLASSIFIER_MODEL_PATH = os.path.join(
    _DATA_SCIENCE, "classification", "models", "hotspot_classifier.keras"
)
CLASSIFIER_SCALER_PATH = os.path.join(
    _DATA_SCIENCE, "classification", "artifacts", "classifier_scaler.pkl"
)
CLASSIFIER_ENCODER_PATH = os.path.join(
    _DATA_SCIENCE, "classification", "artifacts", "label_encoder.pkl"
)
RISK_SCALER_PATH = os.path.join(
    _DATA_SCIENCE, "risk_prediction", "artifacts", "risk_scaler.pkl"
)
RISK_MODEL_PATHS = {
    "1day": os.path.join(_DATA_SCIENCE, "risk_prediction", "models", "gru_1day_best.keras"),
    "3day": os.path.join(_DATA_SCIENCE, "risk_prediction", "models", "gru_3day_best.keras"),
    "7day": os.path.join(_DATA_SCIENCE, "risk_prediction", "models", "gru_7day_best.keras"),
}
# OLD GBM kept per docs/CLASSIFIER_DECISION.md decision (b): model_version="old".
GBM_MODEL_PATH = os.path.join(_REPO_ROOT, "FINAL_GRADIENT_BOOSTING_MODEL.pkl")


@dataclass
class LoadedModels:
    classifier: Any
    classifier_scaler: Any
    label_encoder: Any
    gbm_pipeline: Any | None = None
    risk_models: dict[str, Any] = field(default_factory=dict)
    risk_scaler: Any = None


_models: LoadedModels | None = None


def load_model() -> LoadedModels:
    """Load + validate all seven artifacts. Idempotent; safe to call at startup."""
    global _models
    if _models is not None:
        return _models

    import joblib
    import tensorflow as tf

    # ── Classifier (MLP) + its scaler + label encoder ────────────────────────
    logger.info("loading classifier from %s", CLASSIFIER_MODEL_PATH)
    classifier = tf.keras.models.load_model(CLASSIFIER_MODEL_PATH)
    classifier_scaler = joblib.load(CLASSIFIER_SCALER_PATH)
    label_encoder = joblib.load(CLASSIFIER_ENCODER_PATH)

    # ── Validation against the frozen schema (hard-fail) ────────────────────
    expected_features = len(CLASSIFIER_FEATURES)
    actual_features = classifier.input_shape[-1]
    if actual_features != expected_features:
        raise RuntimeError(
            "classifier schema mismatch: "
            f"model expects {actual_features} input features, "
            f"frozen schema has {expected_features} (CLASSIFIER_FEATURES)"
        )

    encoder_classes = [str(c) for c in getattr(label_encoder, "classes_", [])]
    if encoder_classes != list(CLASSIFIER_CLASSES):
        raise RuntimeError(
            "label encoder classes mismatch: "
            f"expected {list(CLASSIFIER_CLASSES)}, got {encoder_classes}"
        )

    # ── GRU risk models (one per horizon) + risk scaler ─────────────────────
    risk_models: dict[str, Any] = {}
    expected_shape = (None, RISK_SEQUENCE_LENGTH, len(RISK_FEATURES))
    for horizon, path in RISK_MODEL_PATHS.items():
        logger.info("loading GRU %s from %s", horizon, path)
        model = tf.keras.models.load_model(path)
        actual_shape = tuple(model.input_shape)
        if actual_shape != expected_shape:
            raise RuntimeError(
                f"GRU {horizon} input shape mismatch: "
                f"expected {expected_shape}, got {actual_shape}"
            )
        risk_models[horizon] = model
    risk_scaler = joblib.load(RISK_SCALER_PATH)

    # ── OLD GBM classifier (decision (b): keep-alongside, model_version="old")
    logger.info("loading legacy GBM classifier from %s", GBM_MODEL_PATH)
    gbm_pipeline = joblib.load(GBM_MODEL_PATH)
    gbm_features = [str(f) for f in getattr(gbm_pipeline, "feature_names_in_", [])]
    if gbm_features != list(CLASSIFIER_FEATURES_OLD):
        raise RuntimeError(
            "legacy GBM schema mismatch: pipeline expects "
            f"{len(gbm_features)} features, frozen CLASSIFIER_FEATURES_OLD has "
            f"{len(CLASSIFIER_FEATURES_OLD)}"
        )
    gbm_classes = [str(c) for c in getattr(gbm_pipeline, "classes_", [])]
    if gbm_classes != list(CLASSIFIER_CLASSES_OLD):
        raise RuntimeError(
            "legacy GBM classes mismatch: "
            f"expected {list(CLASSIFIER_CLASSES_OLD)}, got {gbm_classes}"
        )

    _models = LoadedModels(
        classifier=classifier,
        classifier_scaler=classifier_scaler,
        label_encoder=label_encoder,
        gbm_pipeline=gbm_pipeline,
        risk_models=risk_models,
        risk_scaler=risk_scaler,
    )
    logger.info(
        "models loaded: classifier(%d features, %d classes), legacy_gbm(%d "
        "features, %d classes), risk horizons=%s",
        expected_features,
        len(CLASSIFIER_CLASSES),
        len(CLASSIFIER_FEATURES_OLD),
        len(CLASSIFIER_CLASSES_OLD),
        sorted(risk_models),
    )
    return _models


def get_model() -> LoadedModels:
    """Return the cached loaded models. Call load_model() first (startup)."""
    if _models is None:
        raise RuntimeError(
            "model not loaded — app startup must call load_model() before serving requests"
        )
    return _models


def is_loaded() -> bool:
    return _models is not None
