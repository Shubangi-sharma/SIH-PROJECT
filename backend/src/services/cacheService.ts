/**
 * cacheService — the one caching layer (§6).
 *
 * In-memory LRU with per-entry TTLs. Redis would only be added if the
 * backend is deployed across multiple instances that need shared cache
 * state — a single-process service does not.
 *
 * TTLs follow the ingestion cadence:
 *   - summaries: until the next ingestion/refresh cycle
 *   - analyses:  until the next refresh (data changes ⇒ analyses change)
 *   - facility list: 24 h
 */

import { LRUCache } from "lru-cache";
import { logger } from "../lib/logger.js";

type nonNullableObject = object;

const log = logger.child({ module: "cache" });

const SUMMARY_TTL_MS = 15 * 60 * 1000; // matches refresh cadence (15 min)
const ANALYSIS_TTL_MS = 15 * 60 * 1000;
const FACILITY_TTL_MS = 24 * 60 * 60 * 1000; // OSM sites barely change

const summaryCache = new LRUCache<string, nonNullableObject>({ max: 500, ttl: SUMMARY_TTL_MS });
const analysisCache = new LRUCache<string, nonNullableObject>({ max: 100, ttl: ANALYSIS_TTL_MS });
const facilityCache = new LRUCache<string, nonNullableObject>({ max: 50, ttl: FACILITY_TTL_MS });

/** Invalidate everything derived from detection data (call after ingestion). */
export function invalidateDataCaches(): void {
  const n = summaryCache.size + analysisCache.size;
  summaryCache.clear();
  analysisCache.clear();
  log.info({ cleared: n }, "data caches invalidated");
}

/** Invalidate the facility catalogue cache (call after facility ingestion). */
export function invalidateFacilityCache(): void {
  facilityCache.clear();
  log.info("facility cache invalidated");
}

export const cacheKeys = {
  facilities: "facilities:all" as const,
  analyses: (bbox: string, from: string, to: string) => `analyses:${bbox}:${from}:${to}`,
  summary: (facilityId: string, factsHash: string) => `summary:${facilityId}:${factsHash}`,
};

/** Through-cache for the facility list (24 h TTL — OSM sites barely change). */
export function getFacilitiesCached<T extends object>(loader: () => T): T {
  const hit = facilityCache.get(cacheKeys.facilities);
  if (hit !== undefined) return hit as T;
  const value = loader();
  facilityCache.set(cacheKeys.facilities, value);
  return value;
}

/** Through-cache for computed analyses (keyed by region + time window). */
export function getAnalysesCached<T extends object>(key: string, loader: () => T): T {
  const hit = analysisCache.get(key);
  if (hit !== undefined) return hit as T;
  const value = loader();
  analysisCache.set(key, value);
  return value;
}

/**
 * Through-cache for generated summaries (keyed by facility + facts hash).
 * Generic: the loader may be async and return the full result object —
 * whatever the provider chain produced is cached verbatim.
 */
export function getSummaryCached<T extends object>(key: string, loader: () => T): T {
  const hit = summaryCache.get(key);
  if (hit !== undefined) return hit as T;
  const value = loader();
  summaryCache.set(key, value);
  return value;
}
