/**
 * chat.controller — POST /api/chat
 *
 * Accepts a user message + optional facilityId for context, plus optional
 * prior conversation turns so the chat reads as a coherent multi-turn
 * conversation. Returns a grounded AI response.
 */

import { Request, Response } from "express";
import { chat, ChatHistoryTurn } from "../services/chatService.js";

export async function postChat(req: Request, res: Response): Promise<void> {
  const { message, facilityId, history } = req.body as {
    message?: string;
    facilityId?: string;
    history?: ChatHistoryTurn[];
  };

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  if (message.length > 2000) {
    res.status(400).json({ error: "message too long (max 2000 chars)" });
    return;
  }

  try {
    const result = await chat(message.trim(), facilityId, history);
    res.status(200).json(result);
  } catch (err) {
    req.app.get("log")?.warn({ err: String(err) }, "chat endpoint error");
    res.status(500).json({
      reply: "An error occurred processing your question. Please try again.",
      provider: "fallback",
      grounded: true,
    });
  }
}
