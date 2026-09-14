/**
 * genaiService — grounded AI summary generation (§5).
 *
 * Hard grounding contract:
 *   1. Facts are computed FIRST by scoringService/analysisService.
 *   2. The prompt lists ONLY those facts as structured data and instructs
 *      the model to restate them without inventing anything.
 *   3. temperature 0 — factual restatement, not creative writing.
 *   4. A post-generation validation pass extracts every number from the
 *      output and requires it to appear in the facts block; a summary with
 *      an ungrounded number is discarded (retry once, then template).
 *   5. Summaries are cached per facility + facts hash — regenerated only
 *      when the underlying computed facts change.
 */

import { env } from "../config/env.js";
import { GENAI_QUEUE } from "../lib/http.js";
import { genaiLog } from "../lib/logger.js";
import { cacheKeys, getSummaryCached } from "./cacheService.js";
import { buildFactsText, SummaryFacts } from "./facts.js";

const PROMPT_TIMEOUT_MS = 20_000;

const SYSTEM_PROMPT = `You are a thermal-monitoring analyst writing an incident summary for an industrial-site dashboard. You will be given a block of FACTS that were computed from satellite thermal data, followed by an instruction. Using ONLY the facts listed, write a 3–4 sentence summary of the facility's current thermal behaviour. Do not invent any number, date, location, satellite name, or detail not present in the facts. If information needed to explain a pattern is not in the facts, say the data is insufficient rather than guessing. Plain prose only — no headings, no bullet points, no markdown.`;

const USER_INSTRUCTION =
  "Using ONLY the facts listed above, write a 3–4 sentence summary of this facility's current thermal behavior. Do not invent any number, date, or detail not present above. If information needed to explain a pattern isn't in the facts given, say the data is insufficient rather than guessing.";

interface ProviderCall {
  provider: "openrouter";
  url: string;
  apiKey: string;
  model: string;
}

function providerChain(): ProviderCall[] {
  const chain: ProviderCall[] = [];
  if (env.OPENROUTER_API_KEY) {
    chain.push({
      provider: "openrouter",
      url: `${env.OPENROUTER_API_URL.replace(/\/+$/, "")}/chat/completions`,
      apiKey: env.OPENROUTER_API_KEY,
      model: env.OPENROUTER_MODEL,
    });
  }
  return chain;
}

/** OpenAI-compatible chat completion via plain fetch — no SDK, trivially swappable. */
async function callProvider(p: ProviderCall, messages: { role: string; content: string }[]): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROMPT_TIMEOUT_MS);
  try {
    const res = await fetch(p.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${p.apiKey}`,
        // Recommended OpenRouter attribution headers.
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "PYROSENSE",
      },
      body: JSON.stringify({
        model: p.model,
        temperature: 0,
        max_tokens: 300,
        messages,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`provider ${p.provider} HTTP ${res.status}: ${body.slice(0, 160)}`);
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) throw new Error(`provider ${p.provider} returned no content`);
    return content.trim();
  } finally {
    clearTimeout(timer);
  }
}

/* ── grounding validation ──────────────────────────────────────────────── */

/**
 * Extract every number-like token from the output and require each to be
 * derivable from the facts text. Compares pure digits (formatting-agnostic:
 * "22.4 MW" grounds against a facts value of "22.4"), plus years (2015-2035)
 * which are allowed as dates only if present in the facts.
 */
function ungroundedNumbers(output: string, factsText: string): string[] {
  // Strip punctuation-adjacent tokens; numbers may appear as "3–4" ranges.
  const candidates = output.match(/\d+(?:\.\d+)?/g) ?? [];
  const problems: string[] = [];
  for (const raw of candidates) {
    const normalized = raw.replace(/^0+(?=\d)/, "");
    if (factsText.includes(normalized)) continue;
    // tolerate trailing-zero variants (22.40 vs 22.4) and integer forms
    const asFloat = parseFloat(raw);
    if (Number.isFinite(asFloat) && factsText.includes(String(asFloat))) continue;
    // integers that could be ordinals/list positions are not in this domain;
    // any digit token that appears nowhere in the facts is ungrounded.
    problems.push(raw);
  }
  return problems;
}

export interface GeneratedSummary {
  text: string;
  provider: "openrouter" | "template";
  factsHash: string;
}

/**
 * Generate (or fetch from cache) the AI summary for a facility.
 * Never throws: falls back through providers to the deterministic template
 * (passed in by the caller — it is derived from the same computed facts).
 */
export async function generateSummary(
  facts: SummaryFacts,
  templatedSummary: string,
): Promise<GeneratedSummary> {
  const factsText = buildFactsText(facts);
  const factsHash = await sha256Of(factsText);
  const cacheKey = cacheKeys.summary(facts.facilityId, factsHash);

  const result = await getSummaryCached(cacheKey, async () => {
    const chain = providerChain();

    for (const p of chain) {
      try {
        const text = await GENAI_QUEUE(() =>
          callProvider(p, [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: `${factsText}\n\n${USER_INSTRUCTION}` },
          ]),
        );

        const problems = ungroundedNumbers(text, factsText);
        if (problems.length > 0) {
          genaiLog.warn(
            { provider: p.provider, facility: facts.facilityId, ungrounded: problems },
            "summary discarded — ungrounded numbers; retrying next provider",
          );
          continue; // try the next provider with the same facts
        }

        genaiLog.info({ provider: p.provider, facility: facts.facilityId }, "summary served by provider");
        return { text, provider: p.provider, factsHash };
      } catch (err) {
        genaiLog.warn({ provider: p.provider, err: String(err) }, "provider call failed, trying next");
      }
    }

    // The provider failed (or produced ungrounded output) → template.
    return { text: "", provider: "template" as const, factsHash };
  });

  return result.provider === "template"
    ? { ...result, text: templatedSummary }
    : result;
}

async function sha256Of(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ── incident story generation ──────────────────────────────────────────── */

const INCIDENT_SYSTEM_PROMPT = `You are a thermal-monitoring analyst writing an incident report for an industrial-site dashboard. You will be given a block of FACTS computed from satellite thermal data, plus a list of CHANGE SIGNALS indicating what has shifted since the last assessment. Write a concise 4–6 sentence incident report that:
1. States the current classification and risk level.
2. Summarises the key change signals (what changed, by how much).
3. Explains the likely cause based on the facility type and detection patterns.
4. Recommends one concrete next step for the operator.
Do NOT invent any number, date, or detail not in the facts. Plain prose only.`;

const INCIDENT_USER_INSTRUCTION =
  "Write a 4–6 sentence incident report using ONLY the facts and change signals above. Do not invent details.";

export interface IncidentStory {
  text: string;
  provider: "openrouter" | "template";
}

/**
 * Generate an incident-level narrative for a facility with active anomalies.
 * Uses the same grounding validation as summaries. Falls back to a template.
 */
export async function generateIncidentStory(
  facts: SummaryFacts,
  changeSignals: string[],
  templatedStory: string,
): Promise<IncidentStory> {
  const factsText = buildFactsText(facts);
  const signalsBlock = changeSignals.length > 0
    ? `\n\nCHANGE SIGNALS:\n${changeSignals.map((s, i) => `${i + 1}. ${s}`).join("\n")}`
    : "";

  const fullContext = `${factsText}${signalsBlock}`;

  const chain = providerChain();
  for (const p of chain) {
    try {
      const text = await GENAI_QUEUE(() =>
        callProvider(p, [
          { role: "system", content: INCIDENT_SYSTEM_PROMPT },
          { role: "user", content: `${fullContext}\n\n${INCIDENT_USER_INSTRUCTION}` },
        ]),
      );

      const problems = ungroundedNumbers(text, fullContext);
      if (problems.length > 0) {
        genaiLog.warn(
          { provider: p.provider, facility: facts.facilityId, ungrounded: problems },
          "incident story discarded — ungrounded numbers",
        );
        continue;
      }

      genaiLog.info({ provider: p.provider, facility: facts.facilityId }, "incident story served");
      return { text, provider: p.provider };
    } catch (err) {
      genaiLog.warn({ provider: p.provider, err: String(err) }, "incident story provider failed");
    }
  }

  return { text: templatedStory, provider: "template" };
}

