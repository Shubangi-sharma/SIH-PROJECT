import { Router } from "express";
import { getAnalyses } from "../controllers/facilities.controller.js";

/** Top-level analyses resource: GET /api/analyses?bbox=… */
export const analysesRouter = Router();

analysesRouter.get("/", getAnalyses);
