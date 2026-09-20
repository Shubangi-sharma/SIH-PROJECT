# PyroSense API contract v2 — BFF `/api/v1` ↔ ML `/internal`

**Phase 3.** Supersedes the v1 pass-through proxy for map/risk reads (v1's
`POST /api/predict`, `GET /api/ml/hotspots`, `GET /api/ml/health` remain
valid — see `api-contract.md`).

Architecture (PDF §9/§16):

```
Browser ──► Node BFF (:4000) /api/v1/* ──► pyrosense_ml (:5000) /internal/*
                │ circuit breaker + LRU + Zod          │ stored risk reads only
                └─ serves stale-but-labeled on ML failure
```

The **browser never calls FastAPI directly**. The BFF validates every
downstream response with Zod; a schema drift fails the route (and serves
degraded data), never `NaN` on the map.

**Contract discipline (Phase 3 §3.3):** every response carries `meta` with
`data_timestamp` and the relevant `model_version` / `feature_schema_version`.
The frontend legend renders "as of {data_timestamp}".

---

## `GET /api/v1/risk?minLat=&maxLat=&minLng=&maxLng=` (or `h3Cells=a,b,c`)

Viewport risk. `bbox` is filled server-side to H3-r7 cells; a comma-list
`h3Cells` overrides it. Cached 5 min per bbox hash (LRU, 500 tiles).

```json
{
  "risks": {
    "873c5a885ffffff": {
      "horizons": {
        "1day": { "probability": 0.70, "level": "HIGH", "threshold": 0.65 },
        "3day": { "probability": 0.73, "level": "HIGH", "threshold": 0.40 },
        "7day": { "probability": 0.71, "level": "HIGH", "threshold": 0.35 }
      },
      "overall": "HIGH",
      "status": "ok",
      "data_timestamp": "2026-09-18T00:00:00+00:00",
      "model_version": "1.0.0",
      "feature_schema_version": "2.0.0"
    }
  },
  "missing": [{ "h3_cell": "873c...", "status": "insufficient_history" }],
  "meta": { "data_timestamp": "…", "stale": false }
}
```

- `missing[]` — cells with no stored prediction (30-day history rule);
  render distinctly, do not hide.
- Degradation: ML down → last cached tile with `meta.stale=true`, else
  `503 { error, meta }`.

## `GET /api/v1/hotspots?bbox=…&type=Industrial&persistent=true&limit=…`

Persistent/recent hotspot clusters (merged view; facility data can be joined
server-side later without a contract change).

```json
{
  "count": 1,
  "hotspots": [
    {
      "cluster_id": "HC-1a2b3c4d5e6f",
      "h3_cell": "873c5a885ffffff",
      "latitude": 20.01, "longitude": 78.02,
      "unique_fire_days": 9, "total_detections": 41,
      "first_seen": "2026-08-01", "last_seen": "2026-09-18",
      "is_persistent": true,
      "class": "Agricultural",
      "confidence": 0.81,
      "needs_review": false,
      "model_version": "1.0.0",
      "contextual_note": "Context-derived classification — not an independent ignition cause"
    }
  ],
  "classes": ["Agricultural", "Forest_Vegetation", "Industrial", "Infrastructure_Energy", "Mining"],
  "meta": { "model_version": "1.0.0", "feature_schema_version": "2.0.0", "data_timestamp": "…" }
}
```

- `needs_review=true` → UI shows **"Needs Review"**; never map to a sixth class.

## `GET /api/v1/cells/:h3`

One cell = click-panel payload: risk (1/3/7-day + overall) + nearby clusters.

```json
{
  "h3_cell": "873c5a885ffffff",
  "risk": { "status": "ok", "horizons": { }, "overall": "HIGH", "data_timestamp": "…" },
  "hotspots": [ /* same shape as /api/v1/hotspots items */ ],
  "classes": [ /* 5 classes */ ],
  "meta": { "data_timestamp": "…" }
}
```

When no stored risk exists: `"risk": { "status": "insufficient_history" }`
(never a fabricated score).

## `POST /api/v1/pipeline/run` (ops; Node cron nightly)

Triggers pyrosense_ml's full pipeline (ingest → weather → aggregate → risk →
hotspots). Returns per-stage reports; stage status also queryable via
`GET /api/ml/health` → `pipeline_jobs`.

---

## Upstream reference: FastAPI `/internal/*` (Node-only)

| Route | Purpose |
|---|---|
| `GET /internal/risk/{h3_cell}` | stored 1/3/7-day + overall for one cell |
| `POST /internal/risk/batch` | `{ h3_cells: [...] }` (max 5000) |
| `GET /internal/hotspots` | clusters, bbox/type/persistent filters |
| `GET /internal/hotspots/{uid}` | full detail incl. feature snapshot |
| `POST /internal/classify` | live point → contextual type (+ Needs Review path) |
| `POST /internal/pipeline/run` | run pipeline stages, job rows recorded |
| `GET /internal/health` | model + DB + last run per pipeline job |

Interactive docs at `/internal/docs` (team only — the BFF is the public face).

**Mirrors:** Node `mlClient.ts` Zod schemas ↔ FastAPI response models ↔ this
document — change all three together.
