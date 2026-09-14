import { Router } from "express";
import { getFirmsCoverage, getFirmsCsv } from "../controllers/firms.controller.js";

export const firmsRouter = Router();

firmsRouter.get("/", getFirmsCsv);
firmsRouter.get("/coverage", getFirmsCoverage);
