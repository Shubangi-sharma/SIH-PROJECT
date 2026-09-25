# How It Works (The Intelligence Pipeline)

PyroSense operates autonomously on an orchestrated pipeline that transforms raw thermal telemetry into contextualized risk signals.

## 1. FIRMS Ingestion
The pipeline starts with `refreshLiveFirms.ts`, running on a 15-minute orchestrated node-cron loop. It requests active VIIRS/MODIS hotspot data from the NASA FIRMS Area API. Since FIRMS restricts NRT API calls to 5-day chunks, the backend fetches the data and maintains a continuous rolling 10-day window cache in-memory, dropping detections older than 10 days.

## 2. Geospatial Binding & H3 Indexing
Detections are bound to precise industrial assets. Using bounding-box pre-filtering, the system fetches polygons (ingested monthly from the OSM Overpass API) and applies precise point-in-polygon ray-casting and Haversine proximity math. Hotspots are also snapped to H3 resolution-7 cells to support spatial clustering and feature lookups for the ML pipelines.

## 3. Fingerprint Mutation & Persistence Filtering
`fingerprintService.ts` rolls the historical baseline forward. The backend weights historical detections dynamically, calculating the mean, variance, and p90/p99 historical thresholds for Fire Radiative Power (FRP). Using a recency-weighted baseline (with a half-life of roughly 15 days), it establishes a "normal" signature. Live data is diffed against this signature to isolate "What Changed".

## 4. Contextual Feature Engineering
For classification and risk prediction, the FastAPI service generates a robust feature matrix (36 features for GBM, 43 for MLP). This involves incorporating data beyond FIRMS: proximity distances from OSM polygons (500m / 1km / 2km / 5km flags), land cover ratios, and real-time weather constraints (Open-Meteo relative humidity, shortwave radiation, and precipitation). The weather window is forward-filled at most 7 days and never backward-filled.

## 5. Hotspot Classification
An ML pipeline processes the engineered features and assigns a contextual class (e.g., *Industrial*, *Mining*, *Agricultural*). The classifier enforces a low-confidence threshold (`< 0.40`). If confidence is below this bar, or feature inputs degraded heavily, the model flags `needs_review=true`, forcing the UI to display "Needs Review" rather than incorrectly assigning a class.

## 6. Risk Horizons (GRU Models)
Cells with 30 consecutive days of feature history are passed to three separate GRU models predicting 1-day, 3-day, and 7-day risk horizons. The output is converted into a HIGH/LOW signal using strict, fixed decision thresholds (1-day: 0.65, 3-day: 0.40, 7-day: 0.35). An overall score is determined (e.g., ≥2 HIGH horizons yields an overall HIGH risk).

## 7. GenAI Summary & Frontend Delivery
When queried by the frontend, the backend extracts the calculated facts (deltas, dates, FRP counts) and generates a strict, low-temperature prompt for OpenRouter. The AI is validated to ensure it restates the numbers identically. The Next.js frontend fetches these final outputs—rendering the hotspots via KD-tree clustering on Leaflet, showing the AI narratives, and mapping the risk horizons to the H3 cells.
