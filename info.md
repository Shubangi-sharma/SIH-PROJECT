# PYROSENSE — Implementation Notes (`info.md`)

> **⚠️ FIRMS NRT history depth (verified empirically, 2026-09).**
> The FIRMS Area API caps a single request at **5 days** (`dayRange 7/10` →
> `Invalid day range. Expects [1..5].`) but **accepts a fixed end-date
> parameter** (`…/{dayRange}/{endDate}`), which is what the backend's
> ingestion job uses to walk backwards in 5-day chunks. NASA's NRT archive
> is a rolling window: data currently **serves ~4.5 months back** (verified:
> 2026-05-01 returns 18,992 rows over India; 2026-04-25 returns 0). The
> ingestion job still iterates a **365-day** request window — as NASA's
> archive deepens, re-running `npm run ingest:firms` backfills the newly
> available history. `GET /api/firms/coverage` reports what is actually
> stored, and the AI prompt states real coverage — never a promise.

---

## 1. What was finally built

A **standalone backend service** (Pass 6) + a pure Next.js frontend.

**`backend/`** — Express + TypeScript + better-sqlite3 (WAL). All external
calls, scoring, and AI generation live here:

| Source | What it provides | How |
|---|---|---|
| **OpenStreetMap Overpass API** | Real industrial sites (refineries, power plants, industrial zones, petroleum wells) | Ingestion job → `facilities` table (tiled ≤15° queries; live requests never touch Overpass) |
| **NASA FIRMS (VIIRS S-NPP NRT)** | Real thermal detections (FRP, brightness, confidence, acquisition time) | Backfill job (5-day dated chunks) + 15-min refresh → `firms_detections` table |
| **OpenRouter (OpenAI-compatible)** | Grounded AI summaries | facts → prompt → number-validation → provider chain → template fallback |

The frontend (`frontend/`) holds **no keys and no computation**: it fetches
precomputed results (`NEXT_PUBLIC_API_BASE_URL`) via SWR. The old in-Next.js
API routes and client-side `lib/scoring.ts` were deleted.

Risk status, Thermal Health Score, "What Changed?" rows, and the AI Summary
are computed by the backend **from real stored FIRMS rows** — never stored on
a facility, never invented.

## 2. Technologies / APIs and how they are used

- **Next.js 14 (App Router)** — pages + two API route handlers that hide keys
  and CORS, and add HTTP caching.
- **OSM Overpass API** (`app/api/facilities/route.ts`) — POST `data=<query>`
  with a union query over `man_made=works`, `power=plant`,
  `landuse=industrial`, `industrial=oil`, `man_made=petroleum_well`.
  Facility `type` is derived from which tag matched; unnamed sites become
  `Industrial Site #<osm-id>`. **Three mirrors are tried in order**
  (`overpass-api.de` → `kumi.systems` → `osm.ch`) because the public
  instances shed load (HTTP 406/429) or stall.
- **NASA FIRMS Area API** (`app/api/firms/route.ts`) — VIIRS S-NPP NRT CSV,
  MAP_KEY kept server-side.
- **SWR** — all client fetching (facilities + FIRMS). Stale-while-revalidate:
  cached data renders instantly, background refresh follows; FIRMS polls
  every **5 min** (its NRT cadence); facilities revalidate gently.
- **react-leaflet + react-leaflet-cluster v3** (v4 needs React 19) — map with
  clustering; a cluster's colour = its **highest-severity member** (severity
  rank rides on each marker's options via a ref callback).
- **Leaflet CircleMarkers** for raw FIRMS points with an FRP-magnitude colour
  gradient, deliberately distinct from the 5-tier risk palette.
- Basemaps unchanged: dark-filtered OSM (CSS invert filter), plain OSM,
  Esri satellite + label overlay. Visual design tokens per `design.md`.

## 3. Final data pipeline (the 10-day question — actual approach)

The brief assumed the FIRMS Area API supports `day_range=10`. **It does not.**
Testing showed the hard cap is **5 days per request** for NRT datasets. No
keyless public endpoint serves arbitrary 10-day windows (per-date archive
hosts `nrt1..nrt10.modaps.eosdis.nasa.gov` were probed — none serve CSV for
arbitrary past dates). The implemented answer:

**Rolling server-side cache (chosen and implemented):**

1. Each request to `/api/firms` fetches the freshest **`day_range=5`** CSV
   for the requested bbox (Next `revalidate=300` ⇒ at most one upstream fetch
   per 5 min per bbox).
2. Rows are merged into an in-process store keyed
   `lat,lng,acq_date,acq_time,satellite` — idempotent, so repeated fetches
   dedupe instead of duplicating detections.
3. Rows older than **10 days** are pruned on every merge.
4. The merged window is returned as FIRMS-format CSV, so the client parser
   treats it exactly like a native response.

Consequence (honest, documented in the route): on a **cold start** the window
holds **5 real days**; it grows toward the **full 10 real days** as the server
stays alive and slices age in. Nothing is interpolated — the window simply
accumulates real data. The alternative considered — serving only 5 days —
was rejected because the classification logic (early-half vs late-half diffs,
"new detection" logic) needs the longer baseline; the cache delivers it
without violating the "no invented data" rule.

Client-side, `parseFirmsCsv` derives each detection's `ageDays` from its
acquisition date and drops anything ≥10 days, mirroring the server's prune so
both sides agree on the window.

## 4. Storage / databases and their roles

**There is no external database.** Storage is deliberately minimal:

| Layer | Mechanism | Role | Lifetime |
|---|---|---|---|
| Rolling FIRMS window | Module-scope `Map<bbox, rows>` inside `app/api/firms/route.ts` | Accumulates the 10-day detection window | Server process lifetime (resets on redeploy/restart; rebuilds from live data within one fetch cycle) |
| Overpass facilities | Next.js Data Cache (`next: { revalidate: 86400 }`) + `Cache-Control: s-maxage=86400, stale-while-revalidate=604800` | 24 h cache of OSM sites; protects the public Overpass endpoint | HTTP cache eviction |
| FIRMS upstream fetch | Next.js Data Cache (`revalidate=300`) + `Cache-Control: s-maxage=300, stale-while-revalidate=60` | Max one FIRMS hit / 5 min / bbox | HTTP cache eviction |
| Client data cache | SWR (in-memory + `sessionStorage`-style provider default) | Instant re-visit renders, dedupe across pages (Shell/TopBar/pages share one cache) | Tab session |

If the product later needs persistence across restarts (warm 10-day windows
immediately after deploys) or true history, the intended step is a small
key-value store (e.g. Redis/SQLite) behind the same route — the route's
store is already isolated behind `mergeIntoStore` / `storeToCsv` for exactly
that swap.

## 5. Workflow: collection → storage → processing → output

```
COLLECT (backend jobs — never request-time)
  ingest:facilities   Overpass union query (tiled ≤15°, meaningful
                      User-Agent required) → facilities table (monthly re-run)
  ingest:firms        FIRMS dated 5-day chunks × 365-day window × 8 regions,
                      1.5 s delay, one transaction per chunk → firms_detections
  refreshLiveFirms    every 15 min (node-cron): last 2 days upserted
                      (idempotent UNIQUE key); caches invalidated

STORAGE
  SQLite (better-sqlite3, WAL): facilities + firms_detections
  indexed on (lat,lng,acq_date) and acq_date; every downstream query filters
  by location and/or time window — millisecond reads

PROCESS  (backend, on request, cached)
  scoringService:    classify last 10 days vs recency-weighted FULL-history
                     baseline: w(d) = exp(−ln(4)·d/30) → a detection 30 days
                     old weighs ¼ of today's; half-life ≈ 15 days
  analysisService:   What-Changed diffs (live window vs prior history),
                     newest-first timeline, structured facts block
  genaiService:      facts → prompt (temp 0, "ONLY these facts") → output
                     number-validated against the facts → OpenRouter →
                     templated summary; cached per facility + facts hash

OUTPUT
  • Frontend (SWR): /api/analyses per region, /api/firms CSV per bbox+window,
    /api/facilities/:id/analyses + /:id/summary per facility.
  • Map: clustered facility markers (colour = worst member) + FRP-gradient
    FIRMS points; 500 ms-debounced viewport refetch; 5-min polling.
  • Empty states stay honest ("No active thermal anomalies in this region").

RESILIENCE
  • Outbound transport: fetch → system curl fallback (sandboxed networks).
  • Overpass mirrors tried in order; User-Agent required; tiled queries;
    empty answers retried on the next mirror.
  • FIRMS/Overpass outages surface honest status chips, never fabricated data.
  • AI: provider chain degrades gracefully to the deterministic template —
    a summary is ALWAYS shown, and it is grounded or templated, never invented.
```

## 6. Verification performed

- `tsc --noEmit` clean; `next build` clean (all 12 routes).
- Live smoke tests through the dev server: FIRMS route returned **real VIIRS
  rows** with correct `Cache-Control`; Overpass mirrors answered **HTTP 200**
  directly (the main instance intermittently 406s under load — hence mirrors).
- Dead-code audit: zero references remain to `mockData`, `SCENARIOS`,
  `INDIA_FACILITIES`, `TimeSlice`, timeline scrubber, or scenario props.
