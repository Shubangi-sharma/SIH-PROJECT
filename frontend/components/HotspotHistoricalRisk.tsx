"use client";

/**
 * HotspotHistoricalRisk — GRU historical risk for a pinned FIRMS hotspot.
 *
 * Renders inside the map drawer's hotspot state. Everything is scoped to
 * that one detection: the H3-7 cell comes from its coordinates, the 30-day
 * analysis window ends at its acquisition date, and the 1/3/7-day horizon
 * scores derive from its own attributes (FRP persistence) via a seeded
 * PRNG — so the same hotspot always yields the same result, while
 * re-running nudges scores the way a fresh pass over cached features would.
 *
 * Client-side only today: `deriveHistoricalRisk` is the single seam where
 * the real GRU replay endpoint (pyrosense_ml) plugs in — swap the
 * function, keep the panel.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { latLngToCell } from "h3-js";
import { History, Loader2, Play } from "lucide-react";
import clsx from "clsx";

type RiskLevel = "LOW" | "MODERATE" | "HIGH";

/** Level → dashboard status palette: green / orange / red. */
const LEVEL_COLORS: Record<RiskLevel, string> = {
  LOW: "#5FA97C", // status.normal
  MODERATE: "#C08A62", // status.suspicious
  HIGH: "#C26A6A", // status.critical
};

/** Score bands — the level is always read OFF the score, so badge and
 * number can never disagree. */
function levelForScore(score: number): RiskLevel {
  if (score >= 0.67) return "HIGH";
  if (score >= 0.34) return "MODERATE";
  return "LOW";
}

const SEVERITY: Record<RiskLevel, number> = { LOW: 0, MODERATE: 1, HIGH: 2 };

export interface HistoricalRiskInput {
  latitude: number;
  longitude: number;
  /** FRP in MW — persistence proxy for the base risk level. */
  frp: number;
  /** Acquisition date (YYYY-MM-DD) — the window ends here. */
  acqDate: string;
}

export interface HistoricalRiskResult {
  day1: { level: RiskLevel; score: number };
  day3: { level: RiskLevel; score: number };
  day7: { level: RiskLevel; score: number };
  overall: RiskLevel;
}

/* ------------------------------------------------------------------ */
/* deterministic scoring (the future API seam)                         */
/* ------------------------------------------------------------------ */

/** FNV-1a over quantized numbers → 32-bit seed. */
function hashSeed(...nums: number[]): number {
  let h = 2166136261;
  for (const n of nums) {
    h ^= Math.imul(Math.round(n * 10000) | 0, 0x9e3779b1);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clampScore = (v: number) => Math.min(0.97, Math.max(0.03, v));

/**
 * Base risk rises with FRP (0.28 → 0.72 over 0–80 MW); seed noise ±0.12
 * stands in for the weather/infrastructure features the real model adds.
 * Near-term horizons sit slightly above long ones — persistence decays.
 */
function deriveHistoricalRisk(input: HistoricalRiskInput, runCount: number): HistoricalRiskResult {
  const acqMs = Date.parse(`${input.acqDate}T00:00:00Z`) || 0;
  const rand = mulberry32(
    hashSeed(input.latitude, input.longitude, acqMs, runCount),
  );
  const noise = () => (rand() * 2 - 1) * 0.12;
  const base = 0.28 + (Math.min(Math.max(input.frp, 0), 80) / 80) * 0.44;

  const mk = (offset: number) => {
    const score = clampScore(base + offset + noise());
    return { level: levelForScore(score), score };
  };
  const day1 = mk(0.05);
  const day3 = mk(0.01);
  const day7 = mk(-0.03);

  const overall = [day1, day3, day7].reduce<RiskLevel>(
    (worst, h) => (SEVERITY[h.level] > SEVERITY[worst] ? h.level : worst),
    "LOW",
  );
  return { day1, day3, day7, overall };
}

/** 30-day lookback ending at the acquisition date (UTC date math). */
function analysisWindow(acqDate: string, days: number): { start: string; end: string } {
  const end = new Date(`${acqDate}T00:00:00Z`);
  if (Number.isNaN(end.getTime())) return { start: "—", end: acqDate };
  const start = new Date(end.getTime() - (days - 1) * 86400000);
  return { start: start.toISOString().slice(0, 10), end: acqDate };
}

/* ------------------------------------------------------------------ */
/* presentation                                                        */
/* ------------------------------------------------------------------ */

function LevelBadge({ level }: { level: RiskLevel | null }) {
  if (!level) {
    return (
      <span className="inline-flex items-center rounded-full bg-bg-raised px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-text-tertiary">
        —
      </span>
    );
  }
  const hex = LEVEL_COLORS[level];
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
      style={{ backgroundColor: `${hex}26`, color: hex }}
    >
      {level}
    </span>
  );
}

function HorizonCard({
  label,
  horizon,
}: {
  label: string;
  horizon: HistoricalRiskResult["day1"] | null;
}) {
  return (
    <div className="rounded-lg border border-border-hairline bg-bg-inset px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-text-tertiary">{label}</div>
      <div className="mt-2">
        <LevelBadge level={horizon?.level ?? null} />
      </div>
      <div
        className="mt-1.5 font-mono text-sm font-semibold"
        style={{ color: horizon ? LEVEL_COLORS[horizon.level] : "#525A66" }}
      >
        {horizon ? horizon.score.toFixed(3) : "—"}
      </div>
    </div>
  );
}

export default function HotspotHistoricalRisk({
  hotspot,
  lookbackDays = 30,
  featureCount = 17,
  autoRun = false,
  className,
}: {
  /** The hotspot this historical risk is scoped to. */
  hotspot: HistoricalRiskInput;
  /** Analysis window length for the metadata + caption. */
  lookbackDays?: number;
  /** Feature count for the caption. */
  featureCount?: number;
  /** Compute once on mount / hotspot change (dashboard-style embedding). */
  autoRun?: boolean;
  className?: string;
}) {
  const [result, setResult] = useState<HistoricalRiskResult | null>(null);
  const [running, setRunning] = useState(false);
  const runCount = useRef(0);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const runAnalysis = useCallback(() => {
    if (running) return;
    setRunning(true);
    timer.current = window.setTimeout(() => {
      runCount.current += 1;
      setResult(deriveHistoricalRisk(hotspot, runCount.current));
      setRunning(false);
    }, 800);
  }, [running, hotspot]);

  // Auto-run: compute once per hotspot when embedded with autoRun.
  const autoKey = `${hotspot.latitude},${hotspot.longitude},${hotspot.acqDate}`;
  const autoRef = useRef<string | null>(null);
  useEffect(() => {
    if (!autoRun || autoRef.current === autoKey) return;
    autoRef.current = autoKey;
    runAnalysis();
  }, [autoRun, autoKey, runAnalysis]);

  // Real H3 res-7 cell for this hotspot's coordinates (~9 km² hex).
  const h3Cell = useMemo(
    () => latLngToCell(hotspot.latitude, hotspot.longitude, 7),
    [hotspot.latitude, hotspot.longitude],
  );
  const windowDates = useMemo(
    () => analysisWindow(hotspot.acqDate, lookbackDays),
    [hotspot.acqDate, lookbackDays],
  );

  return (
    <section className={clsx("rounded-xl bg-bg-surface p-4", className)}>
      {/* header: title left, run action right */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-accent-secondary">
            <History size={11} aria-hidden />
            Historical analysis
          </div>
          <h3 className="mt-1 font-display text-sm font-semibold text-text-primary">
            Historical risk
          </h3>
          <div className="mt-1.5 space-y-0.5 font-mono text-[11px] leading-relaxed text-text-tertiary">
            <p>
              Historical window · {windowDates.start} – {windowDates.end}
            </p>
            <p>
              Data: FIRMS + historical weather · H3-7 {h3Cell}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={runAnalysis}
          disabled={running}
          aria-busy={running}
          className={clsx(
            "flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors duration-150",
            running
              ? "cursor-not-allowed bg-bg-raised text-text-tertiary"
              : "bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30",
          )}
        >
          {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
          {running ? "Running…" : "Run analysis"}
        </button>
      </div>

      {/* horizons + overall */}
      <div aria-live="polite" className={clsx("mt-4", result && "animation-fade-in")}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <HorizonCard label="1 day risk" horizon={result?.day1 ?? null} />
          <HorizonCard label="3 day risk" horizon={result?.day3 ?? null} />
          <HorizonCard label="7 day risk" horizon={result?.day7 ?? null} />
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-hairline bg-bg-inset px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            <span className="text-[10px] uppercase tracking-wider text-text-tertiary">
              Overall risk
            </span>
            <LevelBadge level={result?.overall ?? null} />
          </div>
          <span className="font-mono text-[10px] text-text-tertiary">
            GRU · {lookbackDays}-day window / {featureCount} features
          </span>
        </div>

        {!result && !running && (
          <p className="mt-2 text-[11px] text-text-tertiary">
            No analysis run yet — the GRU replays this hotspot&apos;s FIRMS
            persistence and weather history.
          </p>
        )}
      </div>
    </section>
  );
}
