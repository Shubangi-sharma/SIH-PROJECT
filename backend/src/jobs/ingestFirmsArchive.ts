/**
 * ingestFirmsArchive — one-time/scheduled historical ingestion job (§3).
 *
 * Loops over the past HISTORY_WINDOW_DAYS in 5-day chunks (FIRMS' hard
 * per-request cap, verified) per region bounding box, calling the FIRMS
 * Area API's DATED shape (…/{dayRange}/{endDate}) and writing every row
 * into firms_detections inside ONE transaction per chunk.
 *
 * A 1.5 s delay between requests keeps us well inside NASA's rate limits —
 * this is a batch backfill, not something a user waits on. Run manually:
 *
 *   npm run ingest:firms
 *
 * NOTE (verified empirically 2026-09): NASA's NRT Area API accepts the
 * dated request shape arbitrarily far back, but its rolling archive only
 * SERVES data for roughly the last 4–5 months. The job still iterates the
 * full 365-day window — as NASA's archive deepens, re-running the job
 * backfills the newly available history. getCoverage() reports what is
 * actually stored; the AI prompt shows real coverage, never a promise.
 */

import { GLOBAL_CHUNKS, HISTORY_WINDOW_DAYS, INDIA_BBOX } from "../config/regions.js";
import { db, getCoverage, insertDetections, setState, tx } from "../db/client.js";
import { fetchDated, FirmsCsvRow } from "../services/firmsClient.js";
import { invalidateDataCaches } from "../services/cacheService.js";
import { ingestLog as log } from "../lib/logger.js";

const CHUNK_DAYS = 5; // NASA's verified per-request cap
const DELAY_MS = 1500; // stay well within FIRMS rate limits
const REGIONS = [
  { id: "india", bbox: INDIA_BBOX },
  ...GLOBAL_CHUNKS.map((c) => ({ id: c.id, bbox: c.bbox })),
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toRows(csv: FirmsCsvRow[], region: string): Parameters<typeof insertDetections>[0] {
  return csv.map((r) => ({
    lat: r.latitude,
    lng: r.longitude,
    bright_ti4: r.bright_ti4,
    bright_ti5: r.bright_ti5,
    scan: r.scan,
    track: r.track,
    frp: r.frp,
    acq_date: r.acq_date,
    acq_time: r.acq_time,
    satellite: r.satellite,
    instrument: r.instrument,
    confidence: r.confidence,
    daynight: r.daynight,
    region,
  }));
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function ingestArchive(days = HISTORY_WINDOW_DAYS): Promise<void> {
  const started = Date.now();
  const today = new Date();
  const chunks = Math.ceil(days / CHUNK_DAYS);

  log.info({ days, chunks, regions: REGIONS.length }, "archive ingestion starting");

  let inserted = 0;
  let requests = 0;

  for (const region of REGIONS) {
    const bboxStr = `${region.bbox.west},${region.bbox.south},${region.bbox.east},${region.bbox.north}`;
    log.info({ region: region.id, bbox: bboxStr }, "region start");

    for (let i = 0; i < chunks; i++) {
      const endOffset = i * CHUNK_DAYS + CHUNK_DAYS;
      const endDate = isoDate(new Date(today.getTime() - endOffset * 86_400_000));

      let rows: FirmsCsvRow[] = [];
      try {
        rows = await fetchDated(bboxStr, CHUNK_DAYS, endDate);
      } catch (err) {
        log.warn({ region: region.id, endDate, err: String(err) }, "chunk fetch failed, continuing");
      }
      requests++;

      if (rows.length > 0) {
        // ONE transaction per chunk — batched writes, never one per row (§6)
        inserted += tx(() => insertDetections(toRows(rows, region.id)));
      }

      if (i % 12 === 0) {
        setState(`archive:${region.id}:lastEndDate`, endDate);
        log.info({ region: region.id, endDate, rows: rows.length, insertedSoFar: inserted }, "progress");
      }
      await sleep(DELAY_MS);
    }
    setState(`archive:${region.id}:completedAt`, new Date().toISOString());
  }

  setState("archive:lastCompletedAt", new Date().toISOString());
  invalidateDataCaches();

  const coverage = getCoverage();
  log.info(
    { requests, inserted, elapsedMin: Math.round((Date.now() - started) / 60_000), coverage },
    "archive ingestion finished",
  );
}

// ── CLI entry ───────────────────────────────────────────────────────────
if (process.argv[1]?.includes("ingestFirmsArchive")) {
  ingestArchive()
    .then(() => {
      db.close();
      process.exit(0);
    })
    .catch((err) => {
      log.error({ err: String(err) }, "archive ingestion failed");
      db.close();
      process.exit(1);
    });
}
