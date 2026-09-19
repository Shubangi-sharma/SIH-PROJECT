/**
 * firms.controller — GET /api/firms?bbox=&dayRange= (FIRMS-format CSV)
 *
 * Serves the STORED detections (§3) for a bbox + time window. dayRange is
 * capped at the stored history — the "recent window" contract the frontend
 * already speaks — and bbox must be a specific region, never the whole
 * dataset (§6 payload discipline).
 */

import { Request, Response } from "express";
import { getDetectionsInBox, getCoverage } from "../db/client.js";
import { isValidBbox } from "../services/overpassClient.js";
import { cacheKeys, getFirmsCsvCached } from "../services/cacheService.js";

const HEADER = "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight";

export function getFirmsCsv(req: Request, res: Response): void {
  const bbox = (req.query.bbox as string | undefined) ?? "";
  if (!isValidBbox(bbox)) {
    res.status(400).json({ error: "bbox must be west,south,east,north as numbers" });
    return;
  }

  const [w, s, e, n] = bbox.split(",").map(Number);
  if (![w, s, e, n].every((v) => Number.isFinite(v))) {
    res.status(400).json({ error: "invalid bbox numbers" });
    return;
  }
  const west = w!;
  const south = s!;
  const east = e!;
  const north = n!;

  const dayRange = Math.min(Math.max(parseInt(req.query.dayRange as string, 10) || 10, 1), 365);
  const today = new Date();
  const toDate = today.toISOString().slice(0, 10);
  const fromDate = new Date(today.getTime() - dayRange * 86_400_000).toISOString().slice(0, 10);

  // NOTE: toDate is not part of the cache key — the CSV covers stored history
  // (the DB never holds future rows), so "today" produces the same window all
  // day. The TTL + ingestion invalidation keep it correct after new ingests.
  const csv = getFirmsCsvCached(cacheKeys.firmsCsv(bbox, dayRange), () => {
    const rows = getDetectionsInBox({
      minLat: south,
      maxLat: north,
      minLng: west,
      maxLng: east,
      fromDate,
      toDate,
    });

    // Cap any pathological response at 100k rows; the frontend always asks
    // for bounded windows anyway.
    const capped = rows.slice(0, 100_000);

    const lines = [HEADER];
    for (const r of capped) {
      lines.push(
        [
          r.lat,
          r.lng,
          r.bright_ti4 ?? "",
          "",
          "",
          r.acq_date,
          r.acq_time,
          r.satellite,
          r.instrument,
          r.confidence,
          "",
          r.bright_ti5 ?? "",
          r.frp,
          r.daynight,
        ].join(","),
      );
    }
    return lines.join("\n");
  });

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  res.status(200).send(csv);
}

/** GET /api/firms/coverage — honest data-coverage metadata (used in UI + tests). */
export function getFirmsCoverage(req: Request, res: Response): void {
  res.status(200).json(getCoverage());
}
