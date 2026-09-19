"""Verify classification artifacts agree with each other.

Loads the MLP classifier, its scaler, the label encoder, and the frozen feature
list; asserts that the model's expected input width, the scaler's fitted feature
count, and len(classifier_features) all match. Exits non-zero with a clear,
numbered error if any check fails.
"""

from __future__ import annotations

import sys
from pathlib import Path

import joblib

SCRIPT_DIR = Path(__file__).resolve().parent
BASE = SCRIPT_DIR.parent
ARTIFACTS = BASE / "artifacts"
MODELS = BASE / "models"

FAILURE: str | None = None


def fail(msg: str) -> None:
    global FAILURE
    FAILURE = msg
    print(f"FAIL: {msg}")


def main() -> int:
    # ── Load artifacts ───────────────────────────────────────────────────────
    features = joblib.load(ARTIFACTS / "classifier_features.pkl")
    scaler = joblib.load(ARTIFACTS / "classifier_scaler.pkl")
    label_encoder = joblib.load(ARTIFACTS / "label_encoder.pkl")

    import tensorflow as tf  # imported here so non-TF errors stay readable

    model = tf.keras.models.load_model(MODELS / "hotspot_classifier.keras")

    # ── Checks ───────────────────────────────────────────────────────────────
    model_input_dim = model.input_shape[-1]
    n_features = len(features)
    if model_input_dim != n_features:
        fail(
            "feature-count mismatch: keras model expects "
            f"{model_input_dim} input features, classifier_features.pkl has {n_features}"
        )

    scaler_n = getattr(scaler, "n_features_in_", None)
    if scaler_n is None:
        fail("scaler has no n_features_in_ attribute — is it a fitted StandardScaler?")
    elif scaler_n != n_features:
        fail(
            "feature-count mismatch: scaler was fitted with "
            f"{scaler_n} features, classifier_features.pkl has {n_features}"
        )

    if FAILURE is not None:
        return 1

    print(f"classifier features ({n_features}): {list(features)}")
    print(f"classes: {list(label_encoder.classes_)}")
    print("CLASSIFICATION ARTIFACTS OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
