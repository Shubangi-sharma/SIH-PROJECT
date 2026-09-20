"""compare_classifiers.py — Part D measurement script.

Loads the OLD Gradient Boosting pipeline (FINAL_GRADIENT_BOOSTING_MODEL.pkl,
repo root) directly with joblib, and the NEW MLP stack through the production
loader (app.ml.model_loader.load_model), then prints a side-by-side table and
the two-way feature-set overlap.

Honesty rules (per the Part D spec):
- Metrics that cannot be computed from the loaded objects (held-out accuracy,
  cross-validation) are printed as NOT MEASURABLE HERE — never guessed.
- No synthetic numbers are fabricated for either model.

Run from pyrosense_ml/:  .venv/bin/python scripts/compare_classifiers.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]  # pyrosense_ml/scripts -> pyrosense_ml -> repo root
PYRO = REPO_ROOT / "pyrosense_ml"
sys.path.insert(0, str(PYRO))

GBM_PATH = REPO_ROOT / "FINAL_GRADIENT_BOOSTING_MODEL.pkl"
INTROSPECTION_JSON = PYRO / "scripts" / "model_introspection.json"

COL_W = 34


def row(label: str, old: str, new: str) -> str:
    return f"| {label:<{COL_W}} | {old:<26} | {new:<28} |"


def main() -> int:
    import joblib

    # ── OLD GBM ──────────────────────────────────────────────────────────────
    if not GBM_PATH.exists():
        print(f"FATAL: old GBM pickle not found at {GBM_PATH}")
        return 1
    gbm = joblib.load(GBM_PATH)
    gbm_features = [str(f) for f in getattr(gbm, "feature_names_in_", [])]
    gbm_classes = [str(c) for c in getattr(gbm, "classes_", [])]

    # Historical benchmark numbers, if any, from the only in-repo source.
    gbm_metrics = "NOT MEASURABLE HERE"
    if INTROSPECTION_JSON.exists():
        intro = json.loads(INTROSPECTION_JSON.read_text())
        found = [k for k in intro if any(w in k.lower() for w in ("accuracy", "f1", "precision", "recall"))]
        if found:
            gbm_metrics = f"keys found in introspection: {found}"
    # model_introspection.json holds only feature names/classes/importances,
    # so gbm_metrics stays NOT MEASURABLE HERE unless that changes.

    # ── NEW MLP (production loader; validates against frozen schema) ────────
    from app.ml.model_loader import load_model
    from app.feature_schema import (
        CLASSIFIER_CLASSES,
        CLASSIFIER_FEATURES,
    )

    loaded = load_model()
    mlp_features = list(CLASSIFIER_FEATURES)
    mlp_classes = list(CLASSIFIER_CLASSES)

    # ── D1 table ─────────────────────────────────────────────────────────────
    bar = "+" + "-" * (COL_W + 2) + "+" + "-" * 28 + "+" + "-" * 30 + "+"
    print(bar)
    print(f"| {'Metric':<{COL_W}} | {'Old GBM':<26} | {'New MLP':<28} |")
    print(bar)
    print(row("input features", f"{len(gbm_features)}", f"{len(mlp_features)}"))
    print(row("number of classes", f"{len(gbm_classes)}", f"{len(mlp_classes)}"))
    print(row("class names", "; ".join(gbm_classes), "; ".join(mlp_classes)))
    print(row("random-split accuracy", gbm_metrics, "NOT MEASURABLE HERE*"))
    print(row("random-split macro F1", gbm_metrics, "NOT MEASURABLE HERE*"))
    print(row("spatial-CV accuracy", "N/A*", "NOT MEASURABLE HERE*"))
    print(row("spatial-CV macro F1", "N/A*", "NOT MEASURABLE HERE*"))
    print(bar)
    print("* Old GBM: no held-out evaluation exists anywhere in the repo; the only")
    print("  artifact (model_introspection.json) carries feature importances only.")
    print("* New MLP: Colab notebook evaluation numbers were never frozen into this")
    print("  repo (both model-card READMEs say 'NOT YET PROVIDED'), so no verified")
    print("  notebook numbers are available here either. NOT MEASURABLE HERE is the")
    print("  honest cell, not a blank and not a guess.")
    print()
    print("Model objects:")
    print(f"  GBM: {type(gbm).__name__} (scikit-learn pipeline, trained with sklearn 1.6.1)")
    print(f"  MLP: {type(loaded.classifier).__name__} "
          f"(input_shape={loaded.classifier.input_shape})")

    # ── D2 feature overlap ───────────────────────────────────────────────────
    old_set, new_set = set(gbm_features), set(mlp_features)
    only_old = sorted(old_set - new_set)
    only_new = sorted(new_set - old_set)
    shared = sorted(old_set & new_set)

    print()
    print("=== D2: FEATURE OVERLAY ===")
    print(f"shared features ({len(shared)}): {shared}")
    print(f"\nin OLD 36 but NOT in NEW 43 ({len(only_old)}):")
    for f in only_old:
        print(f"  - {f}")
    print(f"\nin NEW 43 but NOT in OLD 36 ({len(only_new)}):")
    for f in only_new:
        print(f"  - {f}")

    overlap_frac = len(shared) / len(old_set | new_set)
    print(
        f"\nJaccard overlap: {len(shared)}/{len(old_set | new_set)} = {overlap_frac:.2f} "
        f"(old-side coverage {len(shared)}/{len(old_set)} = {len(shared)/len(old_set):.2f})"
    )
    print(
        "Ensemble feasibility: averaging probabilities requires computing BOTH full "
        "feature sets (36 + 43 engineered columns, different names and derivations) "
        "for every prediction, plus a class-space mapping (4 GBM classes vs 5 MLP "
        "classes)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
