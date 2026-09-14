/**
 * chatService — conversational interface grounded in live facility + FIRMS data.
 *
 * Reuses the existing OpenRouter provider chain (same API key, same model).
 * The server stays stateless: the client sends prior turns with each request
 * and live context is injected from the CACHED analyses (same 15-min cache
 * every other endpoint reads — a chat message never re-classifies the whole
 * facility catalogue). Temperature 0.3 (slightly conversational, still
 * grounded).
 */

import { env, hasAiProvider } from "../config/env.js";
import { GENAI_QUEUE } from "../lib/http.js";
import { genaiLog } from "../lib/logger.js";
import { getCoverage } from "../db/client.js";
import { analyzeFacility, analyzeAllFacilities, type FacilityAnalysis } from "./analysisService.js";
import { buildFactsText } from "./facts.js";
import { getAllFacilitiesMerged } from "../db/client.js";
import { cacheKeys, getAnalysesCached } from "./cacheService.js";
import { LIVE_WINDOW_DAYS } from "../config/regions.js";

const CHAT_TIMEOUT_MS = 25_000;

/** History hygiene: hard caps so one abusive client cannot balloon the prompt. */
const MAX_HISTORY_TURNS = 12;
const MAX_TURN_CHARS = 1_000;

const SYSTEM_PROMPT = `You are PYROSENSE AI Assistant, a thermal-monitoring analyst embedded in an industrial site monitoring dashboard. You answer questions about facility thermal health, FIRMS satellite detections, risk scores, and anomalies.

RULES:
1. You will be given a CONTEXT block with current facility data and FIRMS detection statistics. Use ONLY this data to answer questions.
2. Never invent numbers, dates, facility names, or details not present in the context.
3. If the user asks about something not covered in the context, say the data is insufficient rather than guessing.
4. Keep answers concise and factual — this is a monitoring tool, not a chatbot.
5. You may use light markdown for readability: **bold** for facility names and key figures, bullet lists for multi-item answers, and tables for comparisons. Reference specific numbers from the context when relevant.
6. If asked about a specific facility, reference its health score, risk score, and current status.
7. Earlier turns of the conversation may be provided; stay consistent with them, but the CONTEXT block always outranks remembered statements.`;

/**
 * Cached overview classification — the SAME cache the analyses/command
 * endpoints read (15-min TTL, invalidated after each ingestion refresh).
 * Before this, every chat message re-ran the full-facility classification.
 */
function getCachedAnalyses(): FacilityAnalysis[] {
  const key = cacheKeys.analyses("chat-overview", "0", "0");
  return getAnalysesCached(key, () => analyzeAllFacilities(new Date()));
}

function buildContext(facilityId?: string): string {
  const lines: string[] = [];
  const coverage = getCoverage();

  lines.push("=== PYROSENSE LIVE CONTEXT ===");
  lines.push(`Data coverage: ${coverage.minDate ?? "no data"} to ${coverage.maxDate ?? "no data"} (${coverage.rows} total detections)`);
  lines.push(`Live window: last ${LIVE_WINDOW_DAYS} days`);

  if (facilityId) {
    // Focused context on one facility (single-site analysis is millisecond
    // queries against indexed tables — no cache needed).
    const facilities = getAllFacilitiesMerged();
    const facility = facilities.find((f) => f.id === facilityId);
    if (facility) {
      const { facts, narrative } = analyzeFacility(facility, new Date());
      lines.push("");
      lines.push("=== SELECTED FACILITY ===");
      lines.push(buildFactsText(facts));
      if (narrative.whatChanged.length > 0) {
        lines.push("");
        lines.push("What Changed:");
        for (const wc of narrative.whatChanged) {
          lines.push(`  ${wc.kind === "warning" ? "⚠" : "✅"} ${wc.text}${wc.value ? ` (${wc.value})` : ""}`);
        }
      }
    } else {
      lines.push("");
      lines.push(`=== SELECTED FACILITY ===`);
      lines.push(`Facility id "${facilityId}" not found — fall back to the monitoring overview.`);
    }
  } else {
    // Overview context — cached top-level stats
    const analyses = getCachedAnalyses();
    const stats = {
      total: analyses.length,
      withDetections: analyses.filter((a) => a.detectionCount > 0).length,
      critical: analyses.filter((a) => a.status === "critical").length,
      suspicious: analyses.filter((a) => a.status === "suspicious").length,
      watch: analyses.filter((a) => a.status === "watch").length,
      normal: analyses.filter((a) => a.status === "normal").length,
    };
    lines.push("");
    lines.push("=== MONITORING OVERVIEW ===");
    lines.push(`Facilities monitored: ${stats.total}`);
    lines.push(`With thermal detections: ${stats.withDetections}`);
    lines.push(`Critical: ${stats.critical}`);
    lines.push(`Suspicious: ${stats.suspicious}`);
    lines.push(`Watch: ${stats.watch}`);
    lines.push(`Normal: ${stats.normal}`);

    // Top 5 facilities needing attention
    const top5 = [...analyses]
      .sort((a, b) => {
        const rank: Record<string, number> = { critical: 0, suspicious: 1, watch: 2, unknown: 3, normal: 4 };
        return (rank[a.status] ?? 4) - (rank[b.status] ?? 4) || a.score - b.score;
      })
      .slice(0, 5);

    if (top5.length > 0) {
      lines.push("");
      lines.push("Top facilities needing attention:");
      for (const a of top5) {
        lines.push(`  - ${a.facility.name} (${a.facility.type}): status=${a.status}, health=${a.score}, detections=${a.detectionCount}${a.latestFrp != null ? `, latest FRP=${a.latestFrp.toFixed(1)} MW` : ""}`);
      }
    }
  }

  return lines.join("\n");
}

/** One prior conversation turn, already sanitized. */
export interface ChatHistoryTurn {
  role: "user" | "assistant";
  content: string;
}

/** Clamp + filter client-supplied history so it can never blow up the prompt. */
function sanitizeHistory(raw: unknown): ChatHistoryTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: ChatHistoryTurn[] = [];
  for (const item of raw.slice(-MAX_HISTORY_TURNS)) {
    if (!item || typeof item !== "object") continue;
    const { role, content } = item as { role?: unknown; content?: unknown };
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string") continue;
    const clipped = content.trim().slice(0, MAX_TURN_CHARS);
    if (clipped) turns.push({ role, content: clipped });
  }
  return turns;
}

export interface ChatResponse {
  reply: string;
  provider: "openrouter" | "fallback";
  grounded: boolean;
}

export async function chat(
  message: string,
  facilityId?: string,
  history: ChatHistoryTurn[] = [],
): Promise<ChatResponse> {
  if (!hasAiProvider()) {
    return {
      reply: "AI chat is not available — no OpenRouter API key configured. The system is running in template-only mode. You can still view all facility data, scores, and What Changed reports in the dashboard.",
      provider: "fallback",
      grounded: true,
    };
  }

  const context = buildContext(facilityId);
  const priorTurns = sanitizeHistory(history);

  try {
    const reply = await GENAI_QUEUE(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
      try {
        const res = await fetch(
          `${env.OPENROUTER_API_URL.replace(/\/+$/, "")}/chat/completions`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
              "HTTP-Referer": "http://localhost:3000",
              "X-Title": "PYROSENSE",
            },
            body: JSON.stringify({
              model: env.OPENROUTER_MODEL,
              temperature: 0.3,
              max_tokens: 500,
              messages: [
                { role: "system", content: `${SYSTEM_PROMPT}\n\n${context}` },
                ...priorTurns.map((t) => ({ role: t.role, content: t.content })),
                { role: "user", content: message },
              ],
            }),
            signal: controller.signal,
          },
        );

        if (!res.ok) {
          const body = await res.text();
          throw new Error(`OpenRouter HTTP ${res.status}: ${body.slice(0, 160)}`);
        }

        const json = (await res.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        const content = json.choices?.[0]?.message?.content;
        if (!content) throw new Error("OpenRouter returned no content");
        return content.trim();
      } finally {
        clearTimeout(timer);
      }
    });

    genaiLog.info({ facilityId: facilityId ?? "overview", turns: priorTurns.length }, "chat response served");
    return { reply, provider: "openrouter", grounded: true };
  } catch (err) {
    genaiLog.warn({ err: String(err) }, "chat provider call failed");
    return {
      reply: "I'm sorry, I couldn't process your question right now. The AI provider is temporarily unavailable. Please check the dashboard directly for facility status, scores, and anomaly reports.",
      provider: "fallback",
      grounded: true,
    };
  }
}
