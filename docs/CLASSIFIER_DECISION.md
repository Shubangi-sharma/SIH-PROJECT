# Classifier Decision: keep GBM and MLP alongside each other (option b)

Date: 2026-09-20 · Branch: `integrate-dl-models` · Decided from measured evidence via the four-rule protocol below. No conversation context is needed to read this file.

## TL;DR

**Decision: (b) keep both classifiers callable.** The new MLP classifier
(`data_science/classification/`) is the **default** (`model_version="new"`);
the old Gradient Boosting classifier (`FINAL_GRADIENT_BOOSTING_MODEL.pkl`) is
loaded at startup and callable via `model_version="old"`. Both stay in
production. No model was deleted.

## The numbers that drove this (measured, not assumed)

A side-by-side audit was run with `pyrosense_ml/scripts/compare_classifiers.py`
(load the GBM pickle with joblib, load the MLP through the production loader,
print both):

| Metric | Old GBM | New MLP |
|---|---|---|
| input features | 36 | 43 |
| number of classes | 4 | 5 |
| class names | Agricultural_Vegetation, Industrial, Mining_Extraction, Other_Persistent_Thermal_Source | Agricultural, Forest_Vegetation, Industrial, Infrastructure_Energy, Mining |
| random-split accuracy | NOT MEASURABLE HERE | NOT MEASURABLE HERE* |
| random-split macro F1 | NOT MEASURABLE HERE | NOT MEASURABLE HERE* |
| spatial-CV accuracy | N/A (never evaluated spatially) | NOT MEASURABLE HERE* |
| spatial-CV macro F1 | N/A (never evaluated spatially) | NOT MEASURABLE HERE* |

\* Why "NOT MEASURABLE HERE" and not a number:

- The **old GBM** has no held-out evaluation anywhere in the repository. The
  only introspection artifact (`pyrosense_ml/scripts/model_introspection.json`)
  contains feature names, class names, and per-feature importances — zero
  accuracy/F1/precision/recall numbers. No benchmark exists in any README,
  script, or comment in the repo.
- The **new MLP's** Colab evaluation numbers were never frozen into this repo
  either. Both model-card READMEs
  (`data_science/classification/README.md`,
  `data_science/risk_prediction/README.md`) literally read "NOT YET PROVIDED"
  for every metric slot (training samples, random-split accuracy, macro F1,
  5-fold spatial accuracy/F1; per-horizon test accuracy/ROC-AUC/PR-AUC).

Feature-set overlap (measured with the same script):

- Shared features: **15 of 64** distinct names → Jaccard **0.23** (old-side
  coverage 15/36 = 0.42).
- 21 of the GBM's 36 features have no literal counterpart in the MLP's 43
  (e.g. `dominant_land_cover`, `total_detections`, `mean_FRP` vs the MLP's
  `mean_frp` — name variants count as different columns because each model's
  pipeline consumes its own spelling).
- 28 of the MLP's 43 features have no GBM counterpart (all six `near_*`
  proximity flags, `*_brightness`, `*_ssrd`, humidity features, etc.).

## Which rule applied and why

The decision protocol (four rules, first match wins):

1. Replace-blocking: MLP spatial-CV accuracy lower than a verified GBM
   number → keep both, GBM default. **Inapplicable** — no verified GBM number
   exists to compare against.
2. **MATCHED**: no verified accuracy numbers for the old GBM anywhere in the
   repo → you cannot honestly claim the new model is better OR worse by
   comparison → keep both callable via an explicit `model_version` parameter.
3. Replace: MLP spatial-CV measurably higher AND feature sets barely overlap.
   **Inapplicable** — the accuracy half has no verified numbers, so the rule's
   precondition cannot be established.
4. Ensemble: new model measurably better AND feature overlap > half. **Not
   matched on either half** — no verified numbers, and overlap is 0.23, far
   below one half. Ensembling would also need a 4-class→5-class probability
   mapping, because the two models don't even share a label space.

## Consequences of the decision

- `app/ml/model_loader.py` loads the GBM pickle at startup alongside the MLP
  and GRUs, validating its `feature_names_in_` (36) and `classes_` (4) against
  the frozen `CLASSIFIER_FEATURES_OLD` / `CLASSIFIER_CLASSES_OLD` schema.
- `model_version` request parameter: `"new"` (default) → MLP, `"old"` → GBM.
  Default rationale: the MLP is the already-integrated, schema-validated path,
  and its 5-class label space covers hotspots (`Forest_Vegetation`,
  `Infrastructure_Energy`) the 4-class GBM cannot express at all. The default
  is a routing choice, **not** a claim of measured superiority.
- Responses carry `classifier_model_used` (`"mlp_v1"` or `"gbm_v1"`) so
  downstream consumers always know which model answered.
- **Out of scope, flagged:** an honest head-to-head comparison requires
  re-running the OLD GBM's evaluation on a held-out set shared with the MLP —
  and requires a decision on how to map the 4 GBM classes to the 5 MLP
  classes first. Until that happens, no accuracy ranking between the two
  models should be claimed anywhere.
