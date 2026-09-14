/**
 * Small shared server-side helpers that have no other home.
 */

/** Great-circle distance between two lat/lng pairs, kilometres. */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Stable JSON stringify — object key order does not change the hash input. */
export function stableStringify(value: unknown): string {
  const seen = new WeakSet();
  return JSON.stringify(value, (_k, v: unknown) => {
    if (v && typeof v === "object") {
      if (seen.has(v)) return undefined; // cycles
      seen.add(v);
      if (!Array.isArray(v)) {
        const rec = v as Record<string, unknown>;
        const sorted: Record<string, unknown> = {};
        for (const key of Object.keys(rec).sort()) sorted[key] = rec[key];
        return sorted;
      }
    }
    return v;
  });
}

/** SHA-256 hex digest of a string. */
export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
