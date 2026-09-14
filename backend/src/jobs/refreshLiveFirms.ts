/**
 * refreshLiveFirms — recurring near-real-time refresh job (§3).
 *
 * Scheduled every 15 minutes (node-cron, server.ts): fetches the last 2
 * days per region bbox and upserts new rows. The UNIQUE detection key
 * makes replays idempotent, so the database stays current without
 * re-pulling the whole archive. Clears analysis/summary caches afterwards
 * so the next request recomputes against the freshest data.
 */

import { GLOBAL_CHUNKS, INDIA_BBOX } from "../config/regions.js";
import {
  db,
  getCoverage,
  getState,
  insertDetections,
  setState,
  tx,
} from "../db/client.js";
import { fetchRecent } from "../services/firmsClient.js";
import { invalidateDataCaches } from "../services/cacheService.js";
import { ingestLog as log } from "../lib/logger.js";

const RECENT_DAYS = 2; // refresh fetches only the last 1–2 days
const REGIONS = [
  { id: "india", bbox: INDIA_BBOX },
  ...GLOBAL_CHUNKS.map((c) => ({ id: c.id, bbox: c.bbox })),
];

export async function refreshLive(): Promise<{ inserted: number; coverage: ReturnType<typeof getCoverage> }> {
  const started = Date.now();
  let inserted = 0;

  for (const region of REGIONS) {
    const bboxStr = `${region.bbox.west},${region.bbox.south},${region.bbox.east},${region.bbox.north}`;
    try {
      const rows = await fetchRecent(bboxStr, RECENT_DAYS);
      if (rows.length > 0) {
        inserted += tx(() =>
          insertDetections(
            rows.map((r) => ({
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
              region: region.id,
            })),
          ),
        );
      }
    } catch (err) {
      // Never crash the schedule on one region's failure.
      log.warn({ region: region.id, err: String(err) }, "refresh failed for region");
    }
  }

  setState("refresh:lastCompletedAt", new Date().toISOString());
  setState("refresh:lastInserted", String(inserted));

  if (inserted > 0) invalidateDataCaches();

  const coverage = getCoverage();
  log.info({ inserted, ms: Date.now() - started, coverage }, "live refresh finished");
  return { inserted, coverage };
}

// ── CLI entry (npm run refresh:firms) ──────────────────────────────────
if (process.argv[1]?.includes("refreshLiveFirms")) {
  refreshLive()
    .then((r) => {
      db.close();
      process.exit(0);
    })
    .catch((err) => {
      log.error({ err: String(err) }, "live refresh failed");
      db.close();
      process.exit(1);
    });
}
