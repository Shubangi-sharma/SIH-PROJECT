# PyroSense ML Service

ML-powered classification, risk scoring, timelines, and GenAI explanations for
persistent FIRMS thermal hotspots. **A separate service** alongside the
existing Node.js backend (which keeps owning FIRMS ingestion, OSM Overpass
facilities, fingerprinting, and the chat UI).

```
Frontend (3000) ──► Node.js backend (4000) ──► SQLite terra-watch.db  (read-only for ML svc)
              └──► Python ML service (5000) ──► PostgreSQL/PostGIS   (predictions, timelines,
                                                   ▲                  explanations, hotspots)
              joblib model (FINAL_GRADIENT_BOOSTING_MODEL.pkl, scikit-learn 1.6.1)
```

## Architecture

| Concern | Where |
|---|---|
| Frozen 36-feature schema (single source of truth) | `app/feature_schema.py` |
| Model load + validation (startup only) | `app/ml/model_loader.py` |
| Inference (single-row DataFrame, exact column order) | `app/ml/inference.py` |
| Risk score `100·Σ wᵢ·Pᵢ` + key drivers | `app/ml/risk_score.py` |
| Feature engineering (OSM / land cover / weather / SQLite) | `app/features/` |
| PostgreSQL store (SQLAlchemy async + PostGIS) | `app/db/` |
| GenAI explanations (OpenRouter → cache → template) | `app/genai/explanation_service.py` |
| Data access (historical / live / timeline) | `app/data/` |
| API (health, hotspots, predict) | `app/api/` |

**Model contract:** the pickle was trained with scikit-learn **1.6.1** — pinned
in `pyproject.toml`. The loader hard-fails at startup if
`preprocessor.feature_names_in_` or `classes_` deviate from the frozen schema.

**Risk weights:** Industrial 1.0 · Mining 0.85 · Other 0.6 · Agricultural 0.3.

**Leakage guard:** payloads containing `label`, `evidence_score`, `risk_score`,
`confidence`, etc. are rejected with 422 before the model ever sees them.

## Run

```bash
# 1. PostgreSQL + PostGIS (any instance works; container shown)
docker run -d --name pyrosense-ml-postgis \
  -e POSTGRES_USER=pyrosense -e POSTGRES_PASSWORD=pyrosense -e POSTGRES_DB=pyrosense_ml \
  -p 5433:5432 postgis/postgis:16-3.4

# 2. Configure
cp .env.example .env   # adjust DATABASE_URL / SQLITE_PATH / MODEL_PATH

# 3. Start (loads model, creates schema, seeds hotspots if empty)
uv run python -m app.main          # http://localhost:5000

# Or with migrations (prod):
uv run alembic upgrade head
```

### Historical dataset

The service prefers the **original enriched 552-hotspot CSV** (36 features +
lat/lng). Set `PYROSENSE_HISTORICAL_CSV=/path/to/file.csv` and seed:

```bash
uv run python scripts/seed_historical.py --csv path/to/enriched.csv --force
```

Without a CSV, seeding falls back to clustering the Node backend's SQLite
detections — rows are then tagged `dataset_version=0.0.0-sqlite-fallback` and
context features (OSM/land-cover/weather) are training-median placeholders.
Replace them by seeding with the real CSV when available.

## API

| Endpoint | Purpose |
|---|---|
| `GET /health` | model/Postgres status + versions |
| `GET /hotspots` | map-ready list (`?source=&min_lat=&max_lat=&min_lng=&max_lng=`) |
| `GET /hotspots/{id}` | full detail + latest prediction + 36-feature snapshot |
| `GET /hotspots/{id}/timeline?days=10` | daily snapshots for the frontend slider |
| `POST /predict` | classify one hotspot (auto or expert mode, see below) |

### `POST /predict` — two modes

**Auto mode** (default): only coordinates required; all 36 features are
engineered from SQLite detection history + Overpass + OSM land cover +
Open-Meteo (each block median-fallbacks with a warning if unavailable):

```json
{ "latitude": 30.7333, "longitude": 76.7794, "region": "india" }
```

**Expert mode:** pass the full 36-feature vector under `"features"`.

Response carries `class`, `probabilities`, `risk_score` (0–100), `confidence`,
`top_contributing_features`, grounded `explanation`, version triple
(model/dataset/schema), `feature_provenance`, and `warnings`.

## Tests

```bash
uv run python -m pytest tests/ -v        # 19 tests: schema guard, ML, risk
```

## GenAI

Same OpenRouter setup as the Node backend (`OPENROUTER_API_KEY`,
`OPENROUTER_MODEL`, fallback chain). Explanations are grounded in computed
facts only, temperature 0, cached by `hash(features + risk + class)` in
PostgreSQL, with a deterministic template fallback when no key is configured
or all models fail.
