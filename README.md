<div align="center">
  <img src="https://upload.wikimedia.org/wikipedia/commons/e/e5/NASA_logo.svg" alt="NASA" width="80" />
  <h1 align="center">PyroSense</h1>
  <p align="center">
    <strong>Next-Generation Industrial Thermal Intelligence & Risk Orchestration</strong>
  </p>
  <p align="center">
    <a href="#-overview">Overview</a> •
    <a href="#-core-capabilities">Capabilities</a> •
    <a href="#-system-architecture">Architecture</a> •
    <a href="#-the-intelligence-pipeline">Pipeline</a> •
    <a href="#-quickstart">Quickstart</a>
  </p>
</div>

---

## 🛰️ Overview

**PyroSense** is an advanced geospatial intelligence platform that intercepts raw satellite thermal telemetry and transforms it into explainable, risk-ranked insights for industrial infrastructure. 

By continuously ingesting NASA FIRMS (VIIRS & MODIS) active fire data and correlating it against precise infrastructure polygons (via OpenStreetMap Overpass), PyroSense eliminates the noise of raw "heat maps." Instead, it establishes deep, per-facility **thermal fingerprints**—learning what "normal" looks like to automatically detect spatial expansion, anomalous frequencies, and critical shifts in zone activity.

When a thermal event occurs, PyroSense answers the only question that matters: *"Is this routine flaring, or a critical anomaly requiring immediate intervention?"*

---

## ✨ Core Capabilities

### 🔍 Geospatial Correlation Engine
Raw latitude/longitude data is useless without context. PyroSense utilizes point-in-polygon ray-casting and Haversine proximity math to definitively bind satellite thermal detections to specific industrial assets.

### 🧬 Thermal Fingerprinting (Baselining)
We don't rely on static thresholds. PyroSense computes a rolling, multi-dimensional baseline for every monitored facility, tracking:
- **Fire Radiative Power (FRP):** Mean, variance, and p90/p99 historical thresholds.
- **Spatial Signatures:** Typical detection spread and centroid drift.
- **Directional Zone Activity:** Quadrant-based (NE/NW/SE/SW) thermal histories.

### ⚡ "What Changed" Analysis
When live data deviates from a facility's fingerprint, PyroSense generates deterministic, programmatic signals. It detects hidden behaviors such as *“spatial spread expanded by 300m,”* *“unusual activity in historically quiet quadrant,”* or *“detection frequency spiked by 40%.”*

### 🧠 Grounded Generative AI Assistant
An integrated, stateless Chatbot (powered by LLMs) acts as your on-demand data analyst. Crucially, the AI is **heavily grounded in live telemetry**. It cannot hallucinate; it formulates responses solely based on computed risk scores, live FIRMS detections, and exact facility metadata.

### 🎯 Multi-Dimensional Risk Scoring
Assets are dynamically scored (0–100) using a weighted algorithm that balances:
- Inverse facility health
- Classification severity (e.g., *Industrial Fire* vs. *Routine Gas Flare*)
- FRP deviation from historical baselines
- Temporal deterioration trends

---

## 🏗️ System Architecture

PyroSense operates on a decoupled, high-performance monorepo architecture designed for real-time observability.

- **Backend (`/backend`)**: A robust Node.js/Express API powered by a local, ultra-fast `better-sqlite3` database operating in WAL (Write-Ahead Logging) mode. It handles cron-based orchestration, heavy geospatial compute, continuous baselining, and GenAI context injection — and **proxies the ML service** (`/api/predict`, `/api/ml/*`) so the frontend talks to exactly one API origin.
- **ML service (`/pyrosense_ml`)**: A Python FastAPI service owning the trained Gradient Boosting classifier — a frozen 36-feature schema, auto feature engineering (FIRMS history + OSM + land cover + weather), risk scoring, prediction persistence (PostgreSQL/PostGIS), and grounded GenAI explanations.
- **Frontend (`/frontend`)**: A visually stunning Next.js 14 App Router client leveraging React Server Components. Features include a bespoke dark-mode Tailwind UI, Leaflet-powered edge-to-edge geospatial visualization, custom map tile rendering, and timeline scrubbing transport controls.

---

## ⚙️ The Intelligence Pipeline

PyroSense operates autonomously on a 15-minute orchestrated loop:

1. **Telemetry Ingestion:** `refreshLiveFirms.ts` pulls 1–5 days of active VIIRS/MODIS hotspots from NASA.
2. **Geospatial Binding:** `matchingService.ts` executes bbox pre-filtering and precise point-in-polygon matching to assign hotspots.
3. **Fingerprint Mutation:** `fingerprintService.ts` rolls the historical baseline forward for active facilities.
4. **Signal Extraction:** `analysisService.ts` diffs live data against the fingerprint to isolate "What Changed."
5. **Classification & Scoring:** The event is categorized (e.g., *Wildfire, Mining Activity, Persistent Source*), and the facility is pushed to the top of the priority queue if critical.

---

## 🚀 Quickstart

### Prerequisites
- Node.js v18+ & npm v9+
- A NASA FIRMS Map Key ([Get one here](https://firms.modaps.eosdis.nasa.gov/api/map_key/))
- Python 3.12+ with [uv](https://docs.astral.sh/uv/) and Docker (for PostgreSQL/PostGIS)
- *(Optional)* OpenRouter API Key for the GenAI Assistant + ML explanations

### 1. Backend Initialization

```bash
cd backend
npm install

# Configure your environment
cp .env.example .env
# Edit .env and insert your FIRMS_MAP_KEY (ML_API_BASE_URL defaults to :5000)

# Bootstrap the SQLite database and ingest facility geometries
npm run ingest:dataset
npm run match:detections

# Launch the backend engine (Port 4000)
npm run dev
```

### 2. ML Service Initialization (PyroSense ML — classifier + explanations)

In a second terminal:

```bash
cd pyrosense_ml

# 1. PostgreSQL/PostGIS for predictions & timelines (any instance works)
docker run -d --name pyrosense-ml-postgis \
  -e POSTGRES_USER=pyrosense -e POSTGRES_PASSWORD=pyrosense -e POSTGRES_DB=pyrosense_ml \
  -p 5433:5432 postgis/postgis:16-3.4

# 2. Configure (DATABASE_URL / SQLITE_PATH / MODEL_PATH defaults are sane)
cp .env.example .env

# 3. Launch — loads the model, creates the schema, seeds historical hotspots
uv run python -m app.main        # http://localhost:5000
```

The Node backend proxies `POST /api/predict` and `GET /api/ml/hotspots` to
this service (see `docs/api-contract.md`) — the frontend needs only
`NEXT_PUBLIC_API_BASE_URL`. Full API reference: `pyrosense_ml/README.md`.

### 3. Frontend Initialization

In a third terminal:

```bash
cd frontend
npm install

# Launch the Next.js client (Port 3000)
npm run dev
```

Access the **Command Dashboard** at `http://localhost:3000`.

---

<div align="center">
  <i>Engineered for the Smart India Hackathon (SIH).</i>
</div>
