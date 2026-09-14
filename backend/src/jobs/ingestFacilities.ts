/**
 * ingestFacilities — one-time/monthly Overpass ingestion job (§3).
 *
 * Fetches industrial facilities for every region bbox via overpassClient
 * and upserts them into the facilities table. Live requests never call
 * Overpass; they read this table. Re-run monthly (or on demand):
 *
 *   npm run ingest:facilities
 *
 * Large regions are TILED into ≤15°×15° boxes with a small overlap:
 * public Overpass instances return silently-empty results (or 429) for
 * continent-sized union queries, but answer tiled ones reliably. Upserts
 * are idempotent, so overlapping tiles and re-runs are safe.
 */

import { GLOBAL_CHUNKS, INDIA_BBOX, BBox } from "../config/regions.js";
import { db, getCoverage, getState, setState, tx, upsertFacility } from "../db/client.js";
import { fetchFacilitiesByBbox } from "../services/overpassClient.js";
import { invalidateDataCaches, invalidateFacilityCache } from "../services/cacheService.js";
import { ingestLog as log } from "../lib/logger.js";

const REGIONS = [
  { id: "india", bbox: INDIA_BBOX },
  ...GLOBAL_CHUNKS.map((c) => ({ id: c.id, bbox: c.bbox })),
];

const TILE_DEG = 15;
const OVERLAP_DEG = 0.25;

/** Split a bbox into ≤TILE_DEG² tiles with a small overlap at the seams. */
export function tileBbox(bbox: BBox): BBox[] {
  const w = bbox.east - bbox.west;
  const h = bbox.north - bbox.south;
  if (w <= TILE_DEG && h <= TILE_DEG) return [bbox];

  const tiles: BBox[] = [];
  const cols = Math.ceil(w / TILE_DEG);
  const rows = Math.ceil(h / TILE_DEG);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const west = bbox.west + c * TILE_DEG - (c > 0 ? OVERLAP_DEG : 0);
      const east = Math.min(bbox.west + (c + 1) * TILE_DEG + (c < cols - 1 ? OVERLAP_DEG : 0), bbox.east);
      const south = bbox.south + r * TILE_DEG - (r > 0 ? OVERLAP_DEG : 0);
      const north = Math.min(bbox.south + (r + 1) * TILE_DEG + (r < rows - 1 ? OVERLAP_DEG : 0), bbox.north);
      tiles.push({ west, south, east, north });
    }
  }
  return tiles;
}

export async function ingestFacilities(): Promise<{ total: number }> {
  const started = Date.now();
  let total = 0;

  for (const region of REGIONS) {
    const tiles = tileBbox(region.bbox);
    let regionCount = 0;
    let failedTiles = 0;

    for (const tile of tiles) {
      const bboxStr = `${tile.west},${tile.south},${tile.east},${tile.north}`;
      try {
        const facilities = await fetchFacilitiesByBbox(bboxStr);
        // One transaction per tile — batched writes.
        tx(() => {
          for (const f of facilities) {
            upsertFacility({ id: f.id, name: f.name, lat: f.lat, lng: f.lng, type: f.type, source: f.source });
          }
        });
        regionCount += facilities.length;
        log.info({ region: region.id, bbox: bboxStr, facilities: facilities.length }, "tile ingested");
      } catch (err) {
        failedTiles++;
        log.warn({ region: region.id, bbox: bboxStr, err: String(err) }, "tile failed");
      }
    }

    total += regionCount;
    setState(`facilities:${region.id}:count`, String(regionCount));
    log.info({ region: region.id, tiles: tiles.length, failedTiles, facilities: regionCount }, "region ingested");
  }

  setState("facilities:lastCompletedAt", new Date().toISOString());
  invalidateDataCaches();
  invalidateFacilityCache();

  const coverage = getCoverage();
  log.info({ total, ms: Date.now() - started, coverage }, "facility ingestion finished");
  return { total };
}

// ── CLI entry ───────────────────────────────────────────────────────────
if (process.argv[1]?.includes("ingestFacilities")) {
  ingestFacilities()
    .then((r) => {
      db.close();
      process.exit(0);
    })
    .catch((err) => {
      log.error({ err: String(err) }, "facility ingestion failed");
      db.close();
      process.exit(1);
    });
}
