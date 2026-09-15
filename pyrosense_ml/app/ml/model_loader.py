"""Model loader — loads FINAL_GRADIENT_BOOSTING_MODEL.pkl ONCE at startup.

Contract:
- The pipeline is validated against app.feature_schema (feature names, order,
  classes). Any mismatch is a hard startup failure.
- get_model() returns the cached pipeline; it never re-reads the pickle.
- The raw pickle bytes are never exposed; the model object stays in-process.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import joblib

from app.feature_schema import (
    DATASET_VERSION,
    FEATURE_NAMES,
    MODEL_CLASSES,
    MODEL_VERSION,
    SCHEMA_VERSION,
)

logger = logging.getLogger("pyrosense.ml.model_loader")


@dataclass
class LoadedModel:
    pipeline: Any
    feature_names: list[str]
    classes: list[str]
    model_version: str = MODEL_VERSION
    dataset_version: str = DATASET_VERSION
    feature_schema_version: str = SCHEMA_VERSION
    importances: dict[str, float] | None = None


_model: LoadedModel | None = None


def _extract_importances(pipeline: Any) -> dict[str, float]:
    """Per-INPUT-feature importances.

    The GBM sees the OHE-expanded matrix (35 numeric + 6 one-hot land-cover
    columns = 41 transformed features), so feature_importances_ does not map
    1:1 to the 36 input features. Numeric features map directly; the
    categorical's importance is the MAX across its one-hot columns (the
    contribution of the category actually present — summing would inflate it).
    """
    try:
        clf = pipeline.named_steps["model"]
        pre = pipeline.named_steps["preprocessor"]
        out_names = [str(n) for n in pre.get_feature_names_out()]
        imps = clf.feature_importances_
        if len(out_names) != len(imps):
            return {}

        agg: dict[str, float] = {}
        for out_name, imp in zip(out_names, imps):
            # "num__mean_FRP" → "mean_FRP"; "cat__dominant_land_cover_built"
            # → "dominant_land_cover"
            name = out_name.split("__", 1)[-1]
            if name.startswith("dominant_land_cover_"):
                name = "dominant_land_cover"
            if name not in agg or imp > agg[name]:
                agg[name] = float(imp)
        return agg
    except (KeyError, AttributeError, ValueError):
        return {}


def load_model(model_path: str | None = None) -> LoadedModel:
    """Load + validate the pickle. Idempotent; safe to call at startup."""
    global _model
    if _model is not None:
        return _model

    from app.config import settings

    path = model_path or settings.MODEL_PATH
    logger.info("loading model from %s", path)
    pipeline = joblib.load(path)

    # ── Validation against the frozen schema ────────────────────────────────
    pre = pipeline.named_steps["preprocessor"]
    expected = list(FEATURE_NAMES)
    actual = list(pre.feature_names_in_)
    if actual != expected:
        raise RuntimeError(
            "model/pipeline schema mismatch:\n"
            f"  expected {len(expected)} features (frozen schema {SCHEMA_VERSION})\n"
            f"  model has {len(actual)}: {actual[:5]}... vs {expected[:5]}..."
        )

    classes = [str(c) for c in pipeline.classes_]
    if classes != list(MODEL_CLASSES):
        raise RuntimeError(
            f"model classes mismatch: expected {list(MODEL_CLASSES)}, got {classes}"
        )

    importances = _extract_importances(pipeline)
    _model = LoadedModel(
        pipeline=pipeline,
        feature_names=actual,
        classes=classes,
        importances=importances,
    )
    logger.info(
        "model loaded: %d features, %d classes, importance_sum=%.4f",
        len(actual),
        len(classes),
        sum(importances.values()),
    )
    return _model


def get_model() -> LoadedModel:
    """Return the cached loaded model. Call load_model() first (startup)."""
    if _model is None:
        raise RuntimeError(
            "model not loaded — app startup must call load_model() before serving requests"
        )
    return _model


def is_loaded() -> bool:
    return _model is not None
