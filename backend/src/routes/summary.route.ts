import { Router } from "express";
import { getSummary } from "../controllers/summary.controller.js";
import { summaryLimiter } from "../middleware/rateLimiter.js";

export const summaryRouter = Router();

summaryRouter.get("/:id/summary", summaryLimiter, getSummary);
