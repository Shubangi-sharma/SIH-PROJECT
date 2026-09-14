# PYROSENSE — Backend Service

Standalone Node.js/Express + TypeScript + SQLite backend. The Next.js app in
`../frontend/` is a pure frontend and talks to this service over HTTP.

## Architecture

```
src/
  config/
    env.ts                 zod-validated env — fails fast on boot, the only
                           place process.env is read
    regions.ts             bbox definitions + window constants
  routes/                  thin Express routers (per-resource)
  controllers/             HTTP concerns: validate → call service → respond
  services/
    firmsClient.ts         ALL raw NASA FIRMS API calls (nowhere else)
    overpassClient.ts      ALL raw Overpass API calls (nowhere else)
    scoringService.ts      pure scoring math: recency-weighted baseline,
                           classification, Thermal Health Score
    analysisService.ts     DB orchestration: classify facilities, build
                           What-Changed diffs + timelines + facts
    genaiService.ts        grounded AI summary: facts → prompt → validate →
                           OpenRouter → template fallback
    cacheService.ts        LRU + TTL caching layer (§6)
  jobs/
    ingestFirmsArchive.ts  historical backfill (npm run ingest:firms)
    refreshLiveFirms.ts    15-min near-real-time upsert (cron + CLI)
    ingestFacilities.ts    OSM facility ingestion (npm run ingest:facilities)
  db/
    schema.ts              DDL: firms_detections, facilities, ingest_state
    client.ts              better-sqlite3 (WAL) + prepared statements
  middleware/              rateLimiter, requestLogger, errorHandler
  app.ts                   Express assembly (no timers, testable)
  server.ts                entry: HTTP server + node-cron scheduling
```

## Run

```bash
npm install
cp .env.example .env        # fill in FIRMS_MAP_KEY (+ optional AI keys)
npm run ingest:facilities   # one-time OSM catalogue (~5 min)
npm run ingest:firms        # one-time FIRMS history backfill (~35 min)
npm run dev                 # http://localhost:4000 (15-min refresh cron starts)
```

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | uptime + DB coverage + last job runs |
| GET | `/api/facilities?bbox=` | ingested OSM catalogue (bbox-filtered) |
| GET | `/api/analyses?bbox=` | facilities with computed status/score |
| GET | `/api/facilities/:id/analyses` | one facility: classification + narrative |
| GET | `/api/facilities/:id/summary` | grounded AI summary (`provider` field names who served it) |
| GET | `/api/firms?bbox=&dayRange=` | stored detections as FIRMS-format CSV |
| GET | `/api/firms/coverage` | what history the DB actually holds |

## AI summary grounding (§5)

1. Facts (deltas, dates, FRP values, counts) are computed from SQLite first.
2. The prompt lists those facts as structured data and instructs the model to
   restate them — nothing else.
3. `temperature: 0`.
4. Post-generation validation extracts every number in the output and requires
   it to appear in the facts block; ungrounded output is discarded and the next
   provider is tried; final fallback is a deterministic templated summary.
5. Summaries are cached per facility + SHA-256 of the facts block — providers
   are only re-called when the underlying facts change.

Provider chain: **OpenRouter** (`OPENROUTER_*`, OpenAI-compatible) → template.
Each response names the provider that served it.
