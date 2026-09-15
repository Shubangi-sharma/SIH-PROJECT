"""Inspect FINAL_GRADIENT_BOOSTING_MODEL.pkl — dump feature names, classes,
pipeline steps, importances, OHE categories, and imputer statistics (training
medians) so feature_schema.py and risk_score.py can be written from fact.

Run:  uv run python scripts/inspect_model.py [path/to/model.pkl]
"""

import json
import sys
from pathlib import Path

import joblib


def main() -> None:
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "../FINAL_GRADIENT_BOOSTING_MODEL.pkl")
    model = joblib.load(path)

    print("TYPE:", type(model).__module__ + "." + type(model).__name__)
    print("CLASSES_:", list(model.classes_))
    print("n_features_in_:", model.n_features_in_)
    print()

    pre = model.named_steps["preprocessor"]
    clf = model.named_steps["model"]

    print("PREPROCESSOR TRANSFORMERS:")
    for name, trans, cols in pre.transformers_:
        print(f"  - {name}: {type(trans).__name__} cols={list(cols)}")
        if hasattr(trans, "categories_"):
            print("    categories_:", [list(c) for c in trans.categories_])
        if hasattr(trans, "statistics_"):
            print("    statistics_ (training medians):")
            for c, s in zip(cols, trans.statistics_):
                print(f"      {c}: {s!r}")
    if pre.remainder != "drop":
        print("  remainder:", pre.remainder, pre._remainder[2])
    print()

    names = list(pre.feature_names_in_)
    imps = clf.feature_importances_
    print("FEATURE IMPORTANCES (desc):")
    for n, v in sorted(zip(names, imps), key=lambda t: -t[1]):
        print(f"  {v:.4f}  {n}")
    print("sum:", float(imps.sum()))
    print()

    # Machine-readable dump for tests
    dump = {
        "feature_names": names,
        "classes": [str(c) for c in model.classes_],
        "importances": {n: float(v) for n, v in zip(names, imps)},
    }
    out = Path(__file__).parent / "model_introspection.json"
    out.write_text(json.dumps(dump, indent=2))
    print("wrote", out)


if __name__ == "__main__":
    main()
