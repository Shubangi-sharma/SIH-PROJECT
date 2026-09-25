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
/**
 * Fast path for the FIRMS CSV.
 *
 * The backend's serializer emits a fixed header and comma-joined rows with no
 * quoting/escaping (numbers + short enums), so a hand-rolled `split` parse is
 * ~5-10× faster than Papa's full state machine on 10k-100k-row payloads —
 * all of it otherwise on the main thread, which is exactly the "lag between
 * loads" this file's consumer (SWR) experiences.
 *
 * Fallback: if any row's field count doesn't match the header (i.e. real
 * quoting exists), we bail to `Papa.parse` so correctness never depends on
 * the fast path.
 */
function parseFirmsCsvFast(text: string, todayUtc: number): FirmsHotspot[] | null {
  const cut = text.indexOf("\n");
  if (cut === -1) return null;
  const header = text.slice(0, cut);
  if (!header.includes("latitude")) return null;

  const cols = header.split(",");
  if (cols.length !== 14) return null; // matches the backend HEADER exactly
  const i = {
    lat: cols.indexOf("latitude"),
    lng: cols.indexOf("longitude"),
    bright: cols.indexOf("bright_ti4"),
    date: cols.indexOf("acq_date"),
    time: cols.indexOf("acq_time"),
    sat: cols.indexOf("satellite"),
    instr: cols.indexOf("instrument"),
    conf: cols.indexOf("confidence"),
    frp: cols.indexOf("frp"),
    dn: cols.indexOf("daynight"),
  };
  if (Object.values(i).some((v) => v === -1)) return null;

  const out: FirmsHotspot[] = [];
  let start = cut + 1;
  while (start < text.length) {
    let end = text.indexOf("\n", start);
    if (end === -1) end = text.length;
    let line = text.slice(start, end);
    start = end + 1;
    if (line.length === 0) continue;
    if (line.charCodeAt(line.length - 1) === 13) line = line.slice(0, -1); // \r
    const f = line.split(",");
    if (f.length !== cols.length) return null; // unexpected quoting → slow path

    const lat = parseFloat(f[i.lat]!);
    const lng = parseFloat(f[i.lng]!);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const date = f[i.date]!;
    const [y, m, d] = date.split("-").map(Number);
    const ageDays =
      Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)
        ? Math.round((todayUtc - Date.UTC(y, m - 1, d)) / 86_400_000)
        : 0;
    if (ageDays < 0 || ageDays >= 10) continue;

    out.push({
      latitude: lat,
      longitude: lng,
      brightness: parseFloat(f[i.bright]!),
      frp: parseFloat(f[i.frp]!) || 0,
      confidence: f[i.conf]!.trim(),
      satellite: f[i.sat]!.trim(),
      instrument: f[i.instr]!.trim(),
      acqDate: date,
      acqTime: f[i.time]!.trim(),
      daynight: (f[i.dn]!.trim() === "N" ? "N" : "D") as "D" | "N",
      ageDays,
    });
  }
  return out;
}

export function parseFirmsCsv(csv: string, now: Date = new Date()): FirmsHotspot[] {
  const text = csv.trim();
  // Real payloads start with a FIRMS header line; anything else (error JSON,
  // an HTML error page, an empty body) parses to zero hotspots.
  if (!text || !text.includes("latitude")) return [];

  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  const fast = parseFirmsCsvFast(text, todayUtc);
  if (fast !== null) return fast;

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

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
