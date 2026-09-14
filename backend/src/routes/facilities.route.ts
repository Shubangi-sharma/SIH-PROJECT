import { Router } from "express";
import { getAnalyses, getFacilities, getFacilityAnalysis } from "../controllers/facilities.controller.js";

export const facilitiesRouter = Router();

facilitiesRouter.get("/", getFacilities);
facilitiesRouter.get("/analyses", getAnalyses);
facilitiesRouter.get("/:id/analyses", getFacilityAnalysis);
