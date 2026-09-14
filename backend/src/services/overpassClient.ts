/**
 * overpassClient — ALL raw OpenStreetMap Overpass API calls live here,
 * nowhere else. Used only by the facilities ingestion job (§3); live
 * requests are served from the facilities table.
 */

import { env } from "../config/env.js";
import { OVERPASS_QUEUE, httpRequest } from "../lib/http.js";
import { overpassLog } from "../lib/logger.js";

/**
 * Public, FULL-PLANET Overpass endpoints, tried in order.
 * (overpass.osm.ch was deliberately excluded: it serves a Switzerland-only
 * extract and answers global queries with HTTP 200 + zero elements — a
 * silent-failure trap worse than an honest error.)
 * The VK/Mail.ru-hosted instance is listed first because it has proven the
 * most reachable from constrained networks.
 */
const OVERPASS_URLS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  env.OVERPASS_API_URL, // https://overpass-api.de/api/interpreter
  "https://overpass.kumi.systems/api/interpreter",
];

const BBOX_PARAM_WHITELIST = /^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/;

export const isValidBbox = (bbox: string): boolean => BBOX_PARAM_WHITELIST.test(bbox);

/**
 * Public API convention here is (west,south,east,north) — the same order the
 * FIRMS Area API uses. Overpass QL, however, expects (south,west,north,east);
 * feeding it w,s,e,n silently queries the WRONG part of the globe (verified
 * empirically — an "India" box landed in Siberia). Convert explicitly.
 */
export function bboxToOverpass(west: number, south: number, east: number, north: number): string {
  return `${south},${west},${north},${east}`;
}

export function parseBbox(bbox: string): { west: number; south: number; east: number; north: number } | null {
  const [w, s, e, n] = bbox.split(",").map(Number);
  if (![w, s, e, n].every((v) => Number.isFinite(v))) return null;
  return { west: w!, south: s!, east: e!, north: n! };
}

/** Build the union query (same selectors as the previous Next.js route). */
export function buildQuery(bbox: string): string {
  const b = parseBbox(bbox);
  if (!b) throw new Error(`Invalid bbox: ${bbox}`);
  const obb = bboxToOverpass(b.west, b.south, b.east, b.north);
  // The bbox is repeated for every statement — Overpass has no cross-statement
  // bbox shorthand, so each selector needs its own filter.
  return `[out:json][timeout:60];
(
  node["man_made"="works"](${obb});
  way["man_made"="works"](${obb});
  node["power"="plant"](${obb});
  way["power"="plant"](${obb});
  node["landuse"="industrial"](${obb});
  way["landuse"="industrial"](${obb});
  node["industrial"="oil"](${obb});
  way["industrial"="oil"](${obb});
  node["man_made"="petroleum_well"](${obb});
);
out center;`;
}

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export type FacilityType = "Refinery" | "Power Plant" | "Industrial Site" | "Mine";

function deriveType(tags: Record<string, string>): FacilityType {
  if (tags.industrial === "oil" || tags.man_made === "works") return "Refinery";
  if (tags.power === "plant") return "Power Plant";
  if (tags.man_made === "petroleum_well") return "Mine";
  return "Industrial Site"; // landuse=industrial and anything untagged
}

export interface ParsedFacility {
  id: string;
  name: string;
  lat: number;
  lng: number;
  type: FacilityType;
  source: "osm";
}

function parseElements(elements: OverpassElement[]): ParsedFacility[] {
  const seen = new Set<string>();
  const facilities: ParsedFacility[] = [];
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (typeof lat !== "number" || typeof lon !== "number") continue;

    const id = `osm-${el.type}-${el.id}`;
    if (seen.has(id)) continue; // node+way can match the same tagged site
    seen.add(id);

    const tags = el.tags ?? {};
    const name = tags.name?.trim() || `Industrial Site #${el.id}`;
    facilities.push({ id, name, lat, lng: lon, type: deriveType(tags), source: "osm" });
  }
  return facilities;
}

const USER_AGENT = "Pyrosense-Backend/0.1 (industrial thermal monitoring; contact: ops@pyrosense.demo)";

/**
 * POST the query to each mirror in turn; return the first parseable answer.
 * A meaningful User-Agent is REQUIRED — the public mirrors answer requests
 * with the default curl UA with an explicit 429 "include a meaningful
 * User-Agent" error.
 */
export async function fetchFacilitiesByBbox(bbox: string): Promise<ParsedFacility[]> {
  if (!isValidBbox(bbox)) throw new Error(`Invalid bbox: ${bbox}`);
  const query = buildQuery(bbox);

  for (const endpoint of OVERPASS_URLS) {
    try {
      const { text } = await OVERPASS_QUEUE(async () =>
        httpRequest(
          endpoint,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "User-Agent": USER_AGENT,
            },
            body: `data=${encodeURIComponent(query)}`,
          },
          { timeoutMs: 60_000 },
        ),
      );
      const json = JSON.parse(text) as { elements?: OverpassElement[] };
      const facilities = parseElements(json.elements ?? []);
      overpassLog.info({ bbox, endpoint: new URL(endpoint).host, facilities: facilities.length }, "overpass ok");
      // A valid-but-empty answer is treated as a suspected mirror gap
      // (verified failure mode: some instances silently return no elements
      // for large boxes) — try the next mirror before accepting it.
      if (facilities.length > 0) return facilities;
    } catch (err) {
      overpassLog.warn({ bbox, endpoint: new URL(endpoint).host, err: String(err) }, "overpass mirror failed, trying next");
    }
  }
  // All mirrors empty/failed — the area may genuinely have no matches.
  return [];
}
