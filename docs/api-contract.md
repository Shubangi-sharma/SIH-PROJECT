# PyroSense ML API contract (frontend ↔ pyrosense_ml)

**Owner:** `pyrosense_ml/app/api/predict.py` (FastAPI). This document and
`frontend/lib/mlApi.ts` mirror it verbatim — change all three together.

**Transport:** the frontend NEVER calls pyrosense_ml directly. The Node
backend proxies it (pass-through, no reshaping):

| Frontend call | Backend route | Upstream (pyrosense_ml) |
|---|---|---|
| `POST` JSON `{ latitude, longitude, region? }` | `POST /api/predict` | `POST /predict` |
| `GET` | `GET /api/ml/hotspots` | `GET /hotspots` |
| `GET` | `GET /api/ml/health` | `GET /health` |

**Modes.** Auto mode (frontend default): only `latitude`/`longitude` (plus an
optional `region` tag); pyrosense_ml engineers the other 35 features from
SQLite detection history + Overpass + land cover + Open-Meteo. Expert mode
(exists upstream, not exposed in the UI): a full 36-feature `features` dict.
Leakage columns (`label`, `risk_score`, `confidence`, …) are rejected 422
upstream — the Predict form never renders them.

---

## `POST /api/predict` — request

```json
{ "latitude": 30.7333, "longitude": 76.7794, "region": "india" }
```

- `latitude`: number, −90…90 (required)
- `longitude`: number, −180…180 (required)
- `region`: optional string tag (e.g. `"india"`), persisted with the hotspot

## `POST /api/predict` — response (`PredictionResponseDto`)

```json
{
  "hotspot_id": "LIVE-30.7333-76.7794",
  "class": "Industrial",
  "probabilities": {
    "Agricultural_Vegetation": 0.041,
    "Industrial": 0.812,
    "Mining_Extraction": 0.097,
    "Other_Persistent_Thermal_Source": 0.05
  },
  "risk_score": 87.2,
  "confidence": 0.812,
  "top_contributing_features": [
    { "feature": "distance_to_industrial_km", "value": 0.8, "importance": 0.184 },
    { "feature": "lc_built_ratio", "value": 0.72, "importance": 0.121 }
  ],
  "explanation": "Grounded plain-language narrative from the GenAI chain…",
  "explanation_provenance": "openrouter | template",
  "source": "live",
  "model_version": "1.0.0",
  "dataset_version": "1.0.0",
  "feature_schema_version": "1.0.0",
  "prediction_timestamp": "2026-09-15T08:41:22.845120+00:00",
  "feature_provenance": {
    "detections": "sqlite",
    "osm": "overpass",
    "land_cover": "dynamic_world",
    "weather": "open-meteo"
  },
  "warnings": ["weather unavailable — median fallback applied"]
}
```

Field notes:

- `class` — one of the 4 `MODEL_CLASSES` (`Agricultural_Vegetation`,
  `Industrial`, `Mining_Extraction`, `Other_Persistent_Thermal_Source`).
  This is the **Predicted Hotspot Category** (PDF §8) — never to be conflated
  with the monitoring backend's rule-based Risk Status
  (`normal/watch/suspicious/critical/unknown`).
- `probabilities` — per-class map, keys exactly the 4 `MODEL_CLASSES`.
- `risk_score` — 0–100, `100·Σ wᵢ·Pᵢ` (`app/ml/risk_score.py`), 1 dp.
- `confidence` — max probability (the winning class's share).
- `top_contributing_features` — up to 5 `{ feature, value, importance }`
  sorted by deviation×importance.
- `explanation` — GenAI output grounded in computed facts, or the
  deterministic template fallback; `explanation_provenance` tells which.
- `feature_provenance` — per-block source of engineered features
  (`median_fallback` entries mean degraded inputs; surfaced via `warnings`).

**Errors:** `400` (backend: malformed lat/lng), `422` (upstream schema guard:
leakage column / missing feature / bad land-cover value),
`502` (pyrosense_ml unreachable) — `{ "error": "…" }` in every case.

## `GET /api/ml/hotspots` — response (`MlHotspotSummaryDto`)

```json
{
  "count": 552,
  "hotspots": [
    {
      "hotspot_id": "HS-0001",
      "latitude": 30.73,
      "longitude": 76.78,
      "class": "Industrial",
      "confidence": 0.91,
      "risk_score": 88.4,
      "source": "historical",
      "model_version": "1.0.0"
    }
  ]
}
```

`source` filter: `historical | live`. Optional bbox params
(`min_lat`, `max_lat`, `min_lng`, `max_lng`).

## `GET /api/ml/health`

`{ status, service, model_loaded, postgres_connected, model_version,
dataset_version, feature_schema_version, feature_count }`.
