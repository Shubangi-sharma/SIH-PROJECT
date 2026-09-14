# PYROSENSE — Frontend (Next.js)

Pure frontend: every computation (classification, scoring, narratives, AI
summaries) happens in the standalone backend service in `../backend/`. This
app fetches precomputed results over HTTP and renders them.

## Run

```bash
# 1. start the backend first (see ../backend/README.md)
cd ../backend && npm run dev          # http://localhost:4000

# 2. start the frontend
npm install
cp .env.example .env                  # NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
npm run dev                           # http://localhost:3000
```

## Where the data comes from

| What | Where it is computed | Endpoint |
|---|---|---|
| Facility catalogue (OSM) | backend SQLite (ingested from Overpass) | `GET /api/facilities?bbox=` |
| Risk status / health score | backend `scoringService` (recency-weighted baseline) | `GET /api/analyses?bbox=` |
| FIRMS detections (CSV) | backend SQLite (ingested FIRMS archive) | `GET /api/firms?bbox=&dayRange=` |
| What-Changed + timeline | backend `analysisService` | `GET /api/facilities/:id/analyses` |
| AI summary (grounded) | backend `genaiService` → OpenRouter → template | `GET /api/facilities/:id/summary` |

No API keys exist in this app — `NEXT_PUBLIC_API_BASE_URL` is the only env var.
