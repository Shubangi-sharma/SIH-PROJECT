# Hotspot Classification — Model Card

> **Recovery note:** this folder was restored in a Phase 1 recovery commit from the
> Colab-export zip (`classification_model-20260919T081306Z-1-001.zip` — since
> removed from the tree after byte-identical extraction was verified; recover
> it via `git log --diff-filter=D -- '*001.zip'` + `git checkout <commit> --
> <path>`), after the original Phase 1 commit was found to be missing from
> the repository history.

## What this model does
Takes a persistent FIRMS hotspot's surrounding OSM, land-cover, and weather context
and predicts a contextual hotspot type. This is a CONTEXTUAL label derived from
spatial/environmental evidence — it is NOT proof of the actual ignition cause of any
fire. Always describe it this way in any UI or documentation that surfaces this
model's output.

## Files in this folder
- models/hotspot_classifier.keras — the trained MLP model
- artifacts/classifier_scaler.pkl — StandardScaler, MUST be applied to inputs
  before calling the model, in the same order as classifier_features.pkl
- artifacts/label_encoder.pkl — maps the model's numeric output back to class name
  strings
- artifacts/classifier_features.pkl — the exact ordered list of 43 feature names
  the model expects. Any code that builds a feature vector for this model MUST
  produce features in exactly this order.

## Classes
NOT YET PROVIDED

## Metrics
- Training samples: NOT YET PROVIDED
- Random-split accuracy: NOT YET PROVIDED
- Random-split macro F1: NOT YET PROVIDED
- 5-fold spatial mean accuracy: NOT YET PROVIDED
- 5-fold spatial macro F1: NOT YET PROVIDED

## Known limitations
- Labels are rule/evidence-derived, not independent ground-truth ignition causes.
  High accuracy numbers above reflect how well the model reproduces the labeling
  scheme, not real-world causal accuracy.
- An "Unknown"/"Needs Review" path must be preserved in any system using this
  model for cases where evidence doesn't meet the confidence bar for one of the
  trained classes — do not force a classification.
