/**
 * firmsClient — ALL raw NASA FIRMS API calls live here, nowhere else.
 *
 * Two call shapes (both verified against the live API):
 *   1. Recency window:  /{key}/{dataset}/{bbox}/{dayRange}          dayRange 1..5
 *   2. Dated window:    /{key}/{dataset}/{bbox}/{dayRange}/{endDate} dayRange 1..5
 *
 * NASA hard-caps dayRange at 5 (dayRange 7/10 → "Invalid day range. Expects
 * [1..5]."). Longer history is reached by calling the DATED shape repeatedly
 * with fixed end dates — exactly what the ingestion job does.
 */

import { env } from "../config/env.js";
import { FIRMS_MAX_REQUEST_DAYS } from "../config/regions.js";
import { FIRMS_QUEUE, httpRequest } from "../lib/http.js";
import { firmsLog } from "../lib/logger.js";

export const FIRMS_DATASETS = ["VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT"] as const;
export type FirmsDataset = (typeof FIRMS_DATASETS)[number];

/** One raw VIIRS detection, exactly as FIRMS CSV columns name them. */
export interface FirmsCsvRow {
  latitude: number;
  longitude: number;
  bright_ti4: number | null;
  bright_ti5: number | null;
  scan: number | null;
  track: number | null;
  frp: number;
  acq_date: string; // YYYY-MM-DD
  acq_time: string; // HHMM
  satellite: string;
  instrument: string;
  confidence: string;
  daynight: string;
}

function parseCsv(csv: string): FirmsCsvRow[] {
  const text = csv.trim();
  // Error payloads are plain text ("Invalid day range..."); real payloads
  // start with the header line containing "latitude".
  if (!text || !text.includes("latitude")) return [];

  const lines = text.split("\n");
  const header = lines[0]!.split(",").map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const iLat = idx("latitude");
  const iLng = idx("longitude");
  if (iLat < 0 || iLng < 0) return [];

  const rows: FirmsCsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]!.split(",");
    if (cols.length < header.length) continue;
    const lat = parseFloat(cols[iLat]!);
    const lng = parseFloat(cols[iLng]!);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const num = (s: string | undefined): number | null => {
      const n = s === undefined ? NaN : parseFloat(s);
      return Number.isFinite(n) ? n : null;
    };
    rows.push({
      latitude: lat,
      longitude: lng,
      bright_ti4: num(cols[idx("bright_ti4")]),
      bright_ti5: num(cols[idx("bright_ti5")]),
      scan: num(cols[idx("scan")]),
      track: num(cols[idx("track")]),
      frp: num(cols[idx("frp")]) ?? 0,
      acq_date: (cols[idx("acq_date")] ?? "").trim(),
      acq_time: (cols[idx("acq_time")] ?? "").trim(),
      satellite: (cols[idx("satellite")] ?? "").trim(),
      instrument: (cols[idx("instrument")] ?? "").trim(),
      confidence: (cols[idx("confidence")] ?? "").trim(),
      daynight: (cols[idx("daynight")] ?? "").trim(),
    });
  }
  return rows;
}

function csvUrl(bbox: string, days: number, endDate?: string): string {
  const base = `${env.FIRMS_BASE_URL}/${env.FIRMS_MAP_KEY}/VIIRS_SNPP_NRT/${bbox}/${days}`;
  return endDate ? `${base}/${endDate}` : base;
}

function isUpstreamError(csv: string): boolean {
  // "Invalid..." error text or empty payload with no header row
  return !csv.includes("latitude");
}

/**
 * Fetch detections for `bbox` over the last `days` (1..5).
 * These are the LIVE rows — used by the refresh job and served to the client.
 */
export async function fetchRecent(bbox: string, days: number): Promise<FirmsCsvRow[]> {
  const d = Math.min(Math.max(1, Math.round(days)), FIRMS_MAX_REQUEST_DAYS);
  return FIRMS_QUEUE(async () => {
    const { text } = await httpRequest(csvUrl(bbox, d), {}, { timeoutMs: 30_000 });
    if (isUpstreamError(text)) {
      firmsLog.warn({ bbox, days: d }, "FIRMS returned an error payload");
      return [];
    }
    const rows = parseCsv(text);
    firmsLog.info({ bbox, days: d, rows: rows.length }, "FIRMS recent fetch ok");
    return rows;
  });
}

/**
 * Fetch detections for `bbox` over a window ENDING at `endDate`
 * (YYYY-MM-DD, UTC), `days` long (1..5). Archive/backfill shape.
 */
export async function fetchDated(
  bbox: string,
  days: number,
  endDate: string,
): Promise<FirmsCsvRow[]> {
  const d = Math.min(Math.max(1, Math.round(days)), FIRMS_MAX_REQUEST_DAYS);
  return FIRMS_QUEUE(async () => {
    const { text } = await httpRequest(csvUrl(bbox, d, endDate), {}, { timeoutMs: 40_000 });
    if (isUpstreamError(text)) return [];
    return parseCsv(text);
  });
}
