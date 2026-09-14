/**
 * chat.route — mounts POST /api/chat with its own rate limiter.
 */

import { Router } from "express";
import express from "express";
import rateLimit from "express-rate-limit";
import { postChat } from "../controllers/chat.controller.js";

const chatLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Chat rate limit exceeded — retry shortly." },
});

export const chatRouter = Router();
chatRouter.use(express.json({ limit: "8kb" }));
chatRouter.post("/", chatLimiter, postChat);
