import Papa from "papaparse";
import { detectionTimestamp } from "./time";
import type { Detection } from "./types";

/**
 * NASA FIRMS VIIRS active-fire detections (thermal anomalies).
 * Raw sensor points are rendered with an FRP-magnitude gradient — NOT the
 * 5-tier risk-status palette, which is reserved for classified facilities.
 *
 * Classification and scoring now live in the BACKEND (backend/src/services/
 * scoringService.ts). This module is parsing + presentation helpers only.
 */

export type { Detection };

/**
 * A FIRMS hotspot IS a scoring Detection — ageDays is derived at parse time
 * from the acquisition date.
 */
export interface FirmsHotspot extends Detection {}

/**
 * Parse the FIRMS-format CSV served by the backend into hotspots. ageDays is
 * derived from today so tooltips can show recency. Detections older than 10
 * days are dropped — matching the backend's live classification window.
 */
export function parseFirmsCsv(csv: string, now: Date = new Date()): FirmsHotspot[] {
  const text = csv.trim();
  // Real payloads start with a FIRMS header line; anything else (error JSON,
  // an HTML error page, an empty body) parses to zero hotspots.
  if (!text || !text.includes("latitude")) return [];

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  return parsed.data
    .filter((r) => r.latitude && r.longitude)
    .map((r) => {
      const [y, m, d] = (r.acq_date ?? "").split("-").map(Number);
      const ageDays =
        Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)
          ? Math.round((todayUtc - Date.UTC(y, m - 1, d)) / 86_400_000)
          : 0;
      const hotspot: FirmsHotspot = {
        latitude: parseFloat(r.latitude),
        longitude: parseFloat(r.longitude),
        brightness: parseFloat(r.bright_ti4),
        frp: parseFloat(r.frp) || 0,
        confidence: (r.confidence ?? "").trim(),
        satellite: (r.satellite ?? "").trim(),
        instrument: (r.instrument ?? "").trim(),
        acqDate: (r.acq_date ?? "").trim(),
        acqTime: (r.acq_time ?? "").trim(),
        daynight: (r.daynight === "N" ? "N" : "D") as "D" | "N",
        ageDays,
      };
      return hotspot;
    })
    .filter((h) => Number.isFinite(h.latitude) && Number.isFinite(h.longitude))
    .filter((h) => h.ageDays >= 0 && h.ageDays < 10);
}

/** FRP → colour gradient (teal→amber→rose), muted to match the calm palette. */
export function frpColor(frp: number): string {
  if (frp < 2) return "#4FB3B3"; // muted teal
  if (frp < 10) return "#CBB26A"; // muted amber
  return "#C98BA6"; // muted rose
}

/**
 * The FRP gradient bands, shared by the marker colouring and the map legend
 * so the two can never drift apart. Upper bounds in MW (top band is open).
 */
export const FRP_BANDS: { maxMw: number; color: string; label: string }[] = [
  { maxMw: 2, color: frpColor(1), label: "< 2 MW" },
  { maxMw: 10, color: frpColor(5), label: "2–10 MW" },
  { maxMw: Infinity, color: frpColor(50), label: "> 10 MW" },
];

/** FRP → marker radius (4px base, capped so outliers don't dominate). */
export function frpRadius(frp: number): number {
  return Math.min(4 + frp / 40, 10);
}
