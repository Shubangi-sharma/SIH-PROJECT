/**
 * Time formatting helpers (client-safe, no scoring logic).
 */

/** ISO-ish UTC timestamp for a detection, e.g. "2026-09-12 13:41". */
export function detectionTimestamp(acqDate: string, acqTime: string): string {
  const t = acqTime.padStart(4, "0");
  return `${acqDate} ${t.slice(0, 2)}:${t.slice(2, 4)}`;
}
