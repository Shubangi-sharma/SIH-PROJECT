# Wildfire Risk Prediction — Model Card

> **Recovery note:** this folder was restored in a Phase 1 recovery commit from the
> Colab-export zips (`models-20260919T081115Z-1-001.zip`,
> `preprocessed-20260919T081215Z-1-001.zip` — removed from the tree; still
> recoverable via `git log --diff-filter=D -- '*001.zip'` + `git checkout
> <commit> -- <path>`), after the original Phase 1 commit was
> found to be missing from the repository history.

## What this model does
Three separate GRU models predict whether a FIRMS fire detection will occur in an
H3 resolution-7 cell within the next 1, 3, or 7 days, based on the previous 30 days
of fire + weather features for that cell. Outputs are RISK SIGNALS from fixed
decision thresholds, NOT calibrated probabilities. Always describe them this way in
any UI or documentation.

## Files in this folder
- models/gru_1day_best.keras, models/gru_3day_best.keras, models/gru_7day_best.keras
  — the three trained GRU models
- artifacts/risk_scaler.pkl — StandardScaler fitted ONLY on training data. MUST be
  applied to every 30x17 input sequence before calling any of the three models.
- artifacts/feature_names.pkl — the exact ordered list of 17 feature names per day.
  Any code building a daily feature row for this model MUST produce features in
  exactly this order.

## Input shape
Each model expects a sequence of shape (30, 17): 30 days of history, 17 features
per day, in the exact feature order in feature_names.pkl.

## Decision thresholds (NOT calibrated probabilities)
- 1-day horizon: 0.65
- 3-day horizon: 0.40
- 7-day horizon: 0.35

## Overall risk rule
Convert each horizon's score to HIGH/LOW using the threshold above. Then:
2 or more HIGH signals -> overall HIGH. Exactly 1 HIGH -> overall MODERATE.
0 HIGH -> overall LOW.

## Metrics
- Total samples: NOT YET PROVIDED
- 1-day: test accuracy NOT YET PROVIDED, test ROC-AUC NOT YET PROVIDED, test PR-AUC
  NOT YET PROVIDED
- 3-day: test accuracy NOT YET PROVIDED, test ROC-AUC NOT YET PROVIDED, test PR-AUC
  NOT YET PROVIDED
- 7-day: test accuracy NOT YET PROVIDED, test ROC-AUC NOT YET PROVIDED, test PR-AUC
  NOT YET PROVIDED

## Known limitations
- Fire prevalence differs significantly between the validation and test time
  periods, especially for the 3-day and 7-day targets — do not present test
  metrics as universally reliable performance.
- The 7-day model's validation ranking metrics were weak. Treat it as a long-range
  signal only, and say so wherever its output is shown.
- Only a limited number of unique H3 cells are represented in training — do not
  imply nationwide spatial generalization has been proven.
