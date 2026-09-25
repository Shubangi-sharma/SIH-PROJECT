# Decisions, FAQ, and Limitations

This document captures the underlying reasoning for why PyroSense is built the way it is, answers the tricky operational questions, and honestly lists its rough edges.

## Design Decisions

### Why two backends?
The platform demands two fundamentally different workloads. The **Node.js backend** excels at asynchronous HTTP orchestration, running cron jobs for NASA FIRMS ingestion, OSM Overpass API matching, and serving as a strict pass-through for the grounded GenAI explanations. The **Python FastAPI service** handles the ML operations: running Gradient Boosting / MLP classifiers, GRU time-series models, and processing heavy pandas/numpy feature engineering tasks.

### Why SQLite for the Node backend?
The Node backend handles primarily geospatial subsets over small bounding boxes and a rolling 10-day FIRMS window. Using `better-sqlite3` configured in WAL mode provides ultra-fast millisecond reads. Adding a massive, external database for these orchestration tasks would unnecessarily bloat the deployment footprint.

### Why PostgreSQL/PostGIS for the ML Service?
Unlike the Node backend, the ML service manages persistence for historical predictions, risk timelines, and AI explanation caching. PostGIS is uniquely suited to handle advanced spatial queries for long-term historical hotspots.

### Why switch map clustering libraries?
The frontend previously used `react-leaflet-cluster` (unmaintained since 2022). It triggered Leaflet runtime crashes during viewport refetches, especially because it wasn't React-18 strict-mode safe. We swapped it out for a KD-tree indexing approach using `useSupercluster`. This 10x performance rewrite bypassed Leaflet marker limits, allowing the map to render over 50k points seamlessly.

### Why this AI provider setup?
To eliminate hallucinations completely. Instead of letting the AI run free, the Node backend pre-computes strict facts (like deltas, dates, and FRP values). It passes this structured data to OpenRouter with a temperature of `0`. Post-generation validation ensures the model output restates the exact numbers. If the AI provider fails or hallucinates, the request degrades gracefully to a deterministic, pre-built template.

## Honest Answers / Known Limitations

### Are classification labels the actual cause of the fire?
**No.** The classification labels (`Agricultural`, `Forest_Vegetation`, `Industrial`, `Infrastructure_Energy`, `Mining`) are **context-derived**. They are inferred from spatial proximity to OSM landmarks, land cover data, and historical frequency. They are not independent, ground-truth ignition causes.

### The Unknown / Needs Review path is mandatory
When the classifier's confidence is `< 0.40`, or feature engineering falls back on missing sources, the cluster is flagged for review. The classifier never forces an ambiguous detection into a class.

### Are the risk scores calibrated probabilities?
**No.** The GRU horizon scores are decision thresholds (1-day `0.65`, 3-day `0.40`, 7-day `0.35`). They dictate when an H3 cell triggers a HIGH/MODERATE/LOW risk signal. They must never be presented as probabilistic percentages of a fire occurring.

### Why is the 7-day risk model treated differently?
The 7-day GRU model demonstrated weak validation ranking metrics. Furthermore, both the 3-day and 7-day test metrics reflect a large prevalence shift versus the validation set. Consequently, the 7-day output should be treated strictly as a weak, long-range signal.

### Why keep both the old GBM and new MLP classifiers?
A side-by-side audit revealed that the old Gradient Boosting (GBM) model had **zero verified accuracy metrics** (no random-split accuracy or macro F1) recorded anywhere in the repository. Because there are no baseline numbers, we cannot honestly claim the new MLP model is numerically superior. The decision was to keep both classifiers in production. The new MLP is the default (`model_version="new"`) because its 5-class label space can classify hotspots (like `Forest_Vegetation`) that the 4-class GBM cannot express. The GBM remains fully loaded and callable via `model_version="old"`.

### Limited spatial coverage in training
Only 563 unique H3 cells were used in training the risk model. Nationwide spatial generalization has not been proven.

### Weather inputs have documented gaps
Weather is forward-filled at most 7 days and never backward-filled. Missing points fall back to degraded priors or are excluded.

### Feature engineering approximations
Unique H3 cells are approximated by counting distinct rounded detection locations in a radius.

## Where this could improve

- **Per-detection Classification API:** Currently, the API (per `api-reference.md`) only exposes hotspot classifications and risk-horizons for H3-cell clusters. The backend must expose a per-detection classification or a detection-to-cell join so the frontend detail drawer can display individual FIRMS hotspot types.
- **Model Baseline Evaluation:** The old GBM classifier has no verified evaluation numbers on a held-out set. A proper side-by-side evaluation dataset needs to be established and run on the GBM to fairly compare it with the new MLP classifier.
- **Persistent Backend FIRMS Cache:** The Node.js backend maintains the rolling 10-day FIRMS history entirely in process memory. Swapping this out for a small local key-value store (like Redis or SQLite) behind the same route logic would allow warm 10-day windows to survive deployments and restarts.
