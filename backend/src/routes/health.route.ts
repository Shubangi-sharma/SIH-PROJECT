import { Router, Request, Response } from "express";
import { getCoverage } from "../db/client.js";
import { getState } from "../db/client.js";

export const healthRouter = Router();

healthRouter.get("/", (_req: Request, res: Response) => {
  const coverage = getCoverage();
  res.status(200).json({
    status: "ok",
    uptimeSec: Math.round(process.uptime()),
    db: coverage,
    lastRefresh: getState("refresh:lastCompletedAt"),
    lastArchive: getState("archive:lastCompletedAt"),
    lastFacilityIngest: getState("facilities:lastCompletedAt"),
  });
});
