"""One-off helper (Phase 2A, step C1): print both frozen feature tuples.

Reads the pickles produced by the Colab training notebooks and prints their
contents as valid Python tuple literals, so feature_schema.py can be
regenerated without ever hand-typing a feature name.

Run from anywhere:
    pyrosense_ml/.venv/bin/python pyrosense_ml/scripts/_extract_feature_lists.py
"""

from __future__ import annotations

from pathlib import Path

import joblib

# This script lives at <repo>/pyrosense_ml/scripts/, so the repo root is two
# levels up from this file.
REPO_ROOT = Path(__file__).resolve().parents[2]

CLASSIFIER_FEATURES_PKL = (
    REPO_ROOT
    / "data_science"
    / "classification"
    / "artifacts"
    / "classifier_features.pkl"
)
RISK_FEATURES_PKL = (
    REPO_ROOT
    / "data_science"
    / "risk_prediction"
    / "artifacts"
    / "feature_names.pkl"
)

clf_features = joblib.load(CLASSIFIER_FEATURES_PKL)
risk_features = joblib.load(RISK_FEATURES_PKL)

print("CLASSIFIER_FEATURES = (")
for f in clf_features:
    print(f'    "{f}",')
print(")")
print()
print("RISK_FEATURES = (")
for f in risk_features:
    print(f'    "{f}",')
print(")")
