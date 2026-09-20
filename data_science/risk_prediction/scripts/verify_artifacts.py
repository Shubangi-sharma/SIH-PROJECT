"""Verify risk-prediction artifacts agree with each other.

Loads the three GRU models plus the risk scaler and frozen feature list; asserts
len(feature_names) == 17 and that every model's input shape is (None, 30, 17).
Exits non-zero with a clear, per-model error if any check fails.
"""

from __future__ import annotations

import sys
from pathlib import Path

import joblib

SCRIPT_DIR = Path(__file__).resolve().parent
BASE = SCRIPT_DIR.parent
ARTIFACTS = BASE / "artifacts"
MODELS = BASE / "models"

EXPECTED_SHAPE = (None, 30, 17)
FAILURES: list[str] = []


def main() -> int:
    feature_names = joblib.load(ARTIFACTS / "feature_names.pkl")
    scaler = joblib.load(ARTIFACTS / "risk_scaler.pkl")

    import tensorflow as tf  # imported here so non-TF errors stay readable

    models = {
        name: tf.keras.models.load_model(MODELS / f"gru_{name}_best.keras")
        for name in ("1day", "3day", "7day")
    }

    n = len(feature_names)
    if n != 17:
        FAILURES.append(f"feature_names.pkl has {n} entries, expected 17")

    scaler_n = getattr(scaler, "n_features_in_", None)
    if scaler_n is not None and scaler_n != 17:
        FAILURES.append(f"risk_scaler was fitted with {scaler_n} features, expected 17")

    for name, model in models.items():
        actual = tuple(model.input_shape)
        print(f"gru_{name}: input_shape={actual}")
        if actual != EXPECTED_SHAPE:
            FAILURES.append(
                f"gru_{name}_best.keras input_shape mismatch: "
                f"expected {EXPECTED_SHAPE}, got {actual}"
            )

    if FAILURES:
        for f in FAILURES:
            print(f"FAIL: {f}")
        return 1

    print("RISK PREDICTION ARTIFACTS OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
