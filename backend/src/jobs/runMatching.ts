/**
 * runMatching — batch job that matches unmatched detections to facilities.
 *
 * Runs after each ingestion/refresh cycle. Idempotent — only processes
 * detections where facility_id IS NULL.
 *
 *   npm run match:detections
 */

import {
  db,
  getAllFacilitiesMerged,
  getUnmatchedDetections,
  updateDetectionMatch,
  setState,
  tx,
} from "../db/client.js";
import { matchDetections } from "../services/matchingService.js";
import { ingestLog as log } from "../lib/logger.js";

export async function runMatchingJob(): Promise<{ matched: number; unidentified: number }> {
  const started = Date.now();
  const facilities = getAllFacilitiesMerged();
  if (facilities.length === 0) {
    log.warn("no facilities in database — skipping matching");
    return { matched: 0, unidentified: 0 };
  }

  const detections = getUnmatchedDetections();
  if (detections.length === 0) {
    log.info("no unmatched detections — nothing to do");
    return { matched: 0, unidentified: 0 };
  }

  log.info({ detections: detections.length, facilities: facilities.length }, "matching starting");

  const results = matchDetections(detections, facilities);

  let matched = 0;
  let unidentified = 0;

  // Batch update in a single transaction
  tx(() => {
    for (const r of results) {
      updateDetectionMatch(r.detectionId, r.facilityId, r.distanceKm, r.matchType);
      if (r.matchType === "unidentified") unidentified++;
      else matched++;
    }
  });

  setState("matching:lastCompletedAt", new Date().toISOString());
  setState("matching:lastMatched", String(matched));
  setState("matching:lastUnidentified", String(unidentified));

  log.info(
    { matched, unidentified, ms: Date.now() - started },
    "matching finished",
  );
  return { matched, unidentified };
}

// ── CLI entry ───────────────────────────────────────────────────────────
if (process.argv[1]?.includes("runMatching")) {
  runMatchingJob()
    .then(() => {
      db.close();
      process.exit(0);
    })
    .catch((err) => {
      log.error({ err: String(err) }, "matching failed");
      db.close();
      process.exit(1);
    });
}
