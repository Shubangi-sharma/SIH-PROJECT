# Why These Choices

This document answers the core architecture and technology decisions (the "why X, not Y" questions) driving PyroSense.

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
