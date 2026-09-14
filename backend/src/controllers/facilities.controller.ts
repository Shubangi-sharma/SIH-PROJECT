/**
 * facilities.controller — facility list + computed analyses (§7 API shape).
 *
 * The facility list comes from the DB (Overpass is ingestion-only).
 * Analyses are computed per region + time window and served through the
 * analysis cache, so the frontend never pulls the entire dataset in one
 * response — it always asks for a region/time window (§6).
 */

import { Request, Response } from "express";
import { LIVE_WINDOW_DAYS } from "../config/regions.js";
import { FacilityRow, getAllFacilities, getAllFacilitiesMerged } from "../db/client.js";
import { cacheKeys, getAnalysesCached, getFacilitiesCached } from "../services/cacheService.js";
import { analyzeAllFacilities } from "../services/analysisService.js";
import { isValidBbox } from "../services/overpassClient.js";

const json = (res: Response, code: number, body: unknown): void => {
  res.status(code).json(body);
};

/** GET /api/facilities?bbox=w,s,e,n — facilities inside an optional bbox. */
export function getFacilities(req: Request, res: Response): void {
  const bbox = (req.query.bbox as string | undefined) ?? "";
  if (bbox && !isValidBbox(bbox)) {
    json(res, 400, { error: "bbox must be west,south,east,north as numbers" });
    return;
  }

  const facilities = getFacilitiesCached(() => getAllFacilitiesMerged()) as FacilityRow[];
  let out = facilities;

  if (bbox) {
    const [w, s, e, n] = bbox.split(",").map(Number);
    if ([w, s, e, n].every((v) => Number.isFinite(v))) {
      out = facilities.filter(
        (f) => f.lat >= s! && f.lat <= n! && f.lng >= w! && f.lng <= e!,
      );
    }
  }

  json(res, 200, { facilities: out, count: out.length });
}

/** GET /api/analyses?bbox=&from=&to= — classified facilities for a window. */
export function getAnalyses(req: Request, res: Response): void {
  const bbox = (req.query.bbox as string | undefined) ?? "";
  if (bbox && !isValidBbox(bbox)) {
    json(res, 400, { error: "bbox must be west,south,east,north as numbers" });
    return;
  }
  const from = (req.query.from as string | undefined) ?? "0001-01-01";
  const to = (req.query.to as string | undefined) ?? "9999-12-31";

  const key = cacheKeys.analyses(bbox || "all", from, to);
  const analyses = getAnalysesCached(key, () => {
    const [w, s, e, n] = bbox ? bbox.split(",").map(Number) : [];
    const bboxObj =
      bbox && [w, s, e, n].every((v) => Number.isFinite(v))
        ? { west: w!, south: s!, east: e!, north: n! }
        : undefined;
    return analyzeAllFacilities(new Date(), bboxObj);
  });

  json(res, 200, {
    analyses,
    count: analyses.length,
    window: { live: LIVE_WINDOW_DAYS, from, to },
  });
}

/** GET /api/facilities/:id/analyses — full classification + narrative for one. */
export function getFacilityAnalysis(req: Request, res: Response): void {
  const id = req.params.id;
  const facility = getAllFacilitiesMerged().find((f) => f.id === id);
  if (!facility) {
    json(res, 404, { error: `Facility not found: ${id}` });
    return;
  }
  const { classification, narrative } = analyzeFacility(facility, new Date());
  json(res, 200, {
    facility,
    classification,
    narrative: {
      whatChanged: narrative.whatChanged,
      timeline: narrative.timeline,
      templatedSummary: narrative.templatedSummary,
      classification: narrative.classification,
      classificationLabel: narrative.classificationLabel,
    },
  });
}

// Imported late to avoid a circular-looking import block above.
import { analyzeFacility } from "../services/analysisService.js";
