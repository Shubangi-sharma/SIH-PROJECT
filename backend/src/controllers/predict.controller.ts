/**
 * predict.controller — handlers for the pyrosense_ml proxy routes.
 *
 * Validation only guards what the backend itself requires (lat/lng present
 * and numeric on /predict; query-string pass-through on /ml/hotspots).
 * Everything else is forwarded verbatim so pyrosense_ml's own schema guard
 * (422 on leakage columns / missing features) stays authoritative.
 */

import { Request, Response } from "express";
import {
  proxyHotspots as forwardHotspots,
  proxyMlHealth as forwardMlHealth,
  proxyPredict as forwardPredict,
} from "../services/mlProxyService.js";
import { httpLog } from "../lib/logger.js";

export async function proxyPredict(req: Request, res: Response): Promise<void> {
  const { latitude, longitude } = (req.body ?? {}) as {
    latitude?: unknown;
    longitude?: unknown;
  };

  const latOk = typeof latitude === "number" && Number.isFinite(latitude);
  const lngOk = typeof longitude === "number" && Number.isFinite(longitude);
  if (!latOk || !lngOk) {
    res.status(400).json({
      error:
        "latitude and longitude are required as finite numbers (auto mode engineers the other 35 features server-side)",
    });
    return;
  }

  try {
    const { status, body } = await forwardPredict(req.body);
    res.status(status).json(body);
  } catch (err) {
    httpLog.warn({ err: String(err), path: req.path }, "pyrosense_ml proxy failed");
    res.status(502).json({
      error: "ML service unavailable — is pyrosense_ml running (default http://localhost:5000)?",
    });
  }
}

export async function proxyHotspots(req: Request, res: Response): Promise<void> {
  try {
    const { status, body } = await forwardHotspots(req.url.includes("?") ? req.url.slice(req.url.indexOf("?") + 1) : "");
    res.status(status).json(body);
  } catch (err) {
    httpLog.warn({ err: String(err), path: req.path }, "pyrosense_ml proxy failed");
    res.status(502).json({
      error: "ML service unavailable — is pyrosense_ml running (default http://localhost:5000)?",
    });
  }
}

export async function proxyMlHealth(req: Request, res: Response): Promise<void> {
  try {
    const { status, body } = await forwardMlHealth();
    res.status(status).json(body);
  } catch (err) {
    httpLog.warn({ err: String(err), path: req.path }, "pyrosense_ml proxy failed");
    res.status(502).json({
      error: "ML service unavailable — is pyrosense_ml running (default http://localhost:5000)?",
    });
  }
}
