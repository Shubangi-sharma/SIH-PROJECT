import { Router } from "express";
import { getCommand } from "../controllers/command.controller.js";

export const commandRouter = Router();

commandRouter.get("/", getCommand);
