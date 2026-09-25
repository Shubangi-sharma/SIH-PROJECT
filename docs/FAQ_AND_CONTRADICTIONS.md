# FAQ & Contradictions

PyroSense takes a highly empirical approach. This section outlines the genuinely tricky and contradictory parts of the product, stated honestly.

### Are classification labels the actual cause of the fire?
**No.** The classification labels (`Industrial`, `Mining`, `Agricultural`) are **context-derived**. They are inferred from spatial proximity to OSM landmarks, land cover data, and historical frequency. They are not independent, ground-truth ignition causes.

### Are the risk scores calibrated probabilities?
**No.** The GRU horizon scores are decision thresholds (1-day `0.65`, 3-day `0.40`, 7-day `0.35`). They dictate when an H3 cell triggers a HIGH/MODERATE/LOW risk signal. They must never be presented as probabilistic percentages of a fire occurring.

### Why is the 7-day risk model treated differently?
The 7-day GRU model demonstrated weak validation ranking metrics. Furthermore, both the 3-day and 7-day test metrics reflect a large prevalence shift versus the validation set. Consequently, the 7-day output should be treated strictly as a weak, long-range signal.

### Why keep both the old GBM and new MLP classifiers?
A side-by-side audit revealed that the old Gradient Boosting (GBM) model had **zero verified accuracy metrics** (no random-split accuracy or macro F1) recorded anywhere in the repository. Because there are no baseline numbers, we cannot honestly claim the new MLP model is numerically superior. 

The decision was to keep both classifiers in production. The new MLP is the default (`model_version="new"`) because its 5-class label space can classify hotspots (like `Forest_Vegetation`) that the 4-class GBM cannot express. The GBM remains fully loaded and callable via `model_version="old"`.
