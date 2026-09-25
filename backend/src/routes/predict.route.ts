/**
 * predict.route — pass-through proxy routes to pyrosense_ml.
 *
 * Mounted at /api/predict (POST) and /api/ml (GET). Response bodies pass
 * through UNCHANGED — no reshaping — so the contract is defined exactly
 * once (frontend/lib/mlApi.ts mirrors pyrosense_ml's FastAPI response).
 */

import { Router } from "express";
import express from "express";
import rateLimit from "express-rate-limit";
import { proxyMlHealth, proxyHotspots, proxyObservations, proxyPredict } from "../controllers/predict.controller.js";

/** Predictions trigger real compute + GenAI — tighter bucket than general API. */
const predictLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Predict rate limit exceeded — retry shortly." },
});

export const predictRouter = Router();
predictRouter.use(express.json({ limit: "64kb" }));
predictRouter.post("/api/predict", predictLimiter, proxyPredict);
predictRouter.get("/api/ml/health", proxyMlHealth);
predictRouter.get("/api/ml/hotspots", proxyHotspots);
/** Observations are cached upstream + rate-limited like predict (real fetches). */
predictRouter.get("/api/ml/observations", predictLimiter, proxyObservations);
