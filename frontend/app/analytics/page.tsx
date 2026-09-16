"use client";

/**
 * Analytics page (SIH brief §5) — 6 charts, every series computed from real
 * backend data. No mock numbers anywhere: when a source has no data the
 * chart's card renders an honest empty state instead of a plausible axis.
 *
 * Sources:
 *  - /api/analyses (India bbox)  → hotspots by region, by risk status,
 *                                  FRP distribution, by state
 *  - /api/ml/hotspots (proxy)    → by predicted ML category, by confidence
 *  - /api/firms (India bbox)     → detections over time
 *
 * Vocabulary guard: "Predicted category" charts use the ML service's
 * MODEL_CLASSES; the monitoring charts use the rule-based risk statuses.
 * They are never mixed in one chart.
 */

import React, { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Loader2 } from "lucide-react";
import { useAnalyses, useFirms, useMlHotspots } from "@/lib/hooks";
import { INDIA_BBOX, northOrWestRegion, stateForPoint, INDIA_STATE_BBOXES } from "@/lib/regions";
import {
  STATUS_META,
  STATUS_ORDER,
} from "@/lib/types";
import {
  MODEL_CLASSES,
  MODEL_CLASS_COLORS,
  MODEL_CLASS_LABELS,
} from "@/lib/mlApi";
import { frpColor } from "@/lib/firms";

const AXIS = { fill: "#78808C", fontSize: 11 } as const;
const GRID = "#1A2028";

/** Chart card shell with a title + honest empty state. */
function ChartCard({
  title,
  note,
  loading,
  empty,
  children,
  height = 260,
}: {
  title: string;
  note?: string;
  loading?: boolean;
  empty?: boolean;
  children: React.ReactNode;
  height?: number;
}) {
  return (
    <section className="rounded-xl bg-bg-surface p-5">
      <h3 className="font-display text-sm font-semibold text-text-primary">{title}</h3>
      {note && <p className="mt-0.5 text-[11px] leading-relaxed text-text-tertiary">{note}</p>}
      <div style={{ height }} className="mt-4">
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-text-tertiary">
            <Loader2 size={14} className="animate-spin" />
            Loading real data…
          </div>
        ) : empty ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-xs leading-relaxed text-text-tertiary">
            No data available yet — this chart renders only real stored
            observations, never estimates.
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

const tooltipStyle = {
  backgroundColor: "#101418",
  border: "1px solid #1A2028",
  borderRadius: 10,
  fontSize: 12,
  color: "#C6CDD6",
};

export default function AnalyticsPage() {
  const { analyses, isLoading: analysesLoading, error: analysesError } = useAnalyses([INDIA_BBOX]);
  const { hotspots, isLoading: firmsLoading } = useFirms([INDIA_BBOX]);
  const { hotspots: mlHotspots, isLoading: mlLoading, error: mlError } = useMlHotspots("all");

  // Simple historical/live toggle for the ML-category chart.
  const [mlSource, setMlSource] = useState<"all" | "historical" | "live">("all");

  /* ── 1. Hotspots by region (north / west / other) ─────────────────────── */
  const byRegion = useMemo(() => {
    const counts = { north: 0, west: 0, other: 0 };
    for (const a of analyses) {
      if (a.detectionCount > 0) counts[northOrWestRegion(a.facility.lat, a.facility.lng)] += 1;
    }
    return [
      { region: "North", facilities: counts.north },
      { region: "West", facilities: counts.west },
      { region: "Other India", facilities: counts.other },
    ];
  }, [analyses]);

  /* ── 2. Hotspots by state (bbox-assigned, top 10) ─────────────────────── */
  const byState = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of analyses) {
      if (a.detectionCount === 0) continue;
      const st = stateForPoint(a.facility.lat, a.facility.lng);
      if (!st) continue;
      counts.set(st, (counts.get(st) ?? 0) + 1);
    }
    const label = new Map(INDIA_STATE_BBOXES.map((s) => [s.id, s.label]));
    return [...counts.entries()]
      .map(([id, n]) => ({ state: label.get(id) ?? id, facilities: n }))
      .sort((a, b) => b.facilities - a.facilities)
      .slice(0, 10);
  }, [analyses]);

  /* ── 3. Monitored facilities by risk status (rule-based vocabulary) ───── */
  const byRiskStatus = useMemo(
    () =>
      STATUS_ORDER.map((s) => ({
        status: STATUS_META[s].label,
        facilities: analyses.filter((a) => a.status === s).length,
        hex: STATUS_META[s].hex,
      })).filter((r) => r.facilities > 0),
    [analyses],
  );

  /* ── 4. Detections over time (last 10 days, stored FIRMS rows) ────────── */
  const overTime = useMemo(() => {
    const counts = new Map<string, number>();
    for (const h of hotspots) counts.set(h.acqDate, (counts.get(h.acqDate) ?? 0) + 1);
    return [...counts.entries()]
      .map(([date, n]) => ({ date: date.slice(5), detections: n }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [hotspots]);

  /* ── 5. FRP distribution (3 bands, same gradient as the map) ──────────── */
  const frpBands = useMemo(() => {
    const bands = { "< 2 MW": 0, "2–10 MW": 0, "> 10 MW": 0 };
    for (const h of hotspots) {
      if (h.frp < 2) bands["< 2 MW"] += 1;
      else if (h.frp < 10) bands["2–10 MW"] += 1;
      else bands["> 10 MW"] += 1;
    }
    return Object.entries(bands).map(([band, n]) => ({ band, detections: n }));
  }, [hotspots]);

  /* ── 6. Predicted category distribution (ML classes, per source) ──────── */
  const byMlCategory = useMemo(() => {
    const rows = MODEL_CLASSES.map((cls) => ({
      cls,
      name: MODEL_CLASS_LABELS[cls],
      hotspots: mlHotspots.filter((h) => h.class === cls).length,
      hex: MODEL_CLASS_COLORS[cls],
    }));
    return rows;
  }, [mlHotspots]);

  const mlVisible = mlSource === "all" ? mlHotspots : mlHotspots.filter((h) => h.source === mlSource);
  const mlFilteredByCategory = useMemo(
    () =>
      MODEL_CLASSES.map((cls) => ({
        name: MODEL_CLASS_LABELS[cls],
        hotspots: mlVisible.filter((h) => h.class === cls).length,
        hex: MODEL_CLASS_COLORS[cls],
      })),
    [mlVisible],
  );

  const anyMlData = mlHotspots.length > 0;

  return (
    <div className="pyro-scroll h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6 p-6 pb-20">
        <header className="pt-4">
          <h1 className="font-display text-2xl font-semibold text-text-primary">Analytics</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Distribution charts computed from the backend&apos;s stored FIRMS
            archive and the ML service&apos;s hotspot catalogue — no estimates.
          </p>
          {(analysesError || mlError) && (
            <p className="mt-2 rounded-lg border border-border-strong bg-bg-surface px-3 py-2 text-xs text-status-watch">
              {analysesError ? "Backend analyses unavailable. " : ""}
              {mlError ? "ML hotspot catalogue unavailable (is pyrosense_ml running?). " : ""}
              Charts render as soon as their source responds.
            </p>
          )}
        </header>

        <div className="grid gap-6 lg:grid-cols-2">
          <ChartCard
            title="Hotspot-active facilities by region"
            note="Facilities with ≥1 FIRMS detection in the live window (PDF §2 north/west split)."
            loading={analysesLoading && analyses.length === 0}
            empty={!analysesLoading && analyses.length === 0}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byRegion} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="region" tick={AXIS} axisLine={{ stroke: GRID }} tickLine={false} />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
                <ReTooltip contentStyle={tooltipStyle} cursor={{ fill: "#151A20" }} />
                <Bar dataKey="facilities" fill="#6E93BE" radius={[3, 3, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="Top states by hotspot-active facilities"
            note="Point-in-bbox assignment — coarse granularity, real counts only."
            loading={analysesLoading && analyses.length === 0}
            empty={byState.length === 0}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={byState}
                layout="vertical"
                margin={{ top: 4, right: 16, bottom: 0, left: 8 }}
              >
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={AXIS} axisLine={{ stroke: GRID }} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="state" tick={AXIS} axisLine={false} tickLine={false} width={110} />
                <ReTooltip contentStyle={tooltipStyle} cursor={{ fill: "#151A20" }} />
                <Bar dataKey="facilities" fill="#5CA0AD" radius={[0, 3, 3, 0]} maxBarSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="Monitored facilities by risk status"
            note="Rule-based monitoring classification (Normal → Critical) — not the ML model's categories."
            loading={analysesLoading && analyses.length === 0}
            empty={!analysesLoading && analyses.length === 0}
          >
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={byRiskStatus}
                  dataKey="facilities"
                  nameKey="status"
                  innerRadius={55}
                  outerRadius={90}
                  paddingAngle={2}
                  stroke="#0B0E11"
                >
                  {byRiskStatus.map((r) => (
                    <Cell key={r.status} fill={r.hex} />
                  ))}
                </Pie>
                <Legend wrapperStyle={{ fontSize: 11, color: "#78808C" }} />
                <ReTooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="Detections over time"
            note="Stored VIIRS acquisitions per UTC day (10-day rolling window)."
            loading={firmsLoading && hotspots.length === 0}
            empty={!firmsLoading && overTime.length === 0}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={overTime} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={AXIS} axisLine={{ stroke: GRID }} tickLine={false} />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
                <ReTooltip contentStyle={tooltipStyle} />
                <Line
                  type="monotone"
                  dataKey="detections"
                  stroke="#4FB3B3"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="FRP distribution"
            note="Fire radiative power bands — same gradient as the map markers."
            loading={firmsLoading && hotspots.length === 0}
            empty={!firmsLoading && hotspots.length === 0}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={frpBands} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="band" tick={AXIS} axisLine={{ stroke: GRID }} tickLine={false} />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
                <ReTooltip contentStyle={tooltipStyle} cursor={{ fill: "#151A20" }} />
                <Bar dataKey="detections" radius={[3, 3, 0, 0]} maxBarSize={48}>
                  {frpBands.map((r) => (
                    <Cell key={r.band} fill={frpColor(r.band === "< 2 MW" ? 1 : r.band === "2–10 MW" ? 5 : 50)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="Predicted hotspot categories (ML model)"
            note="pyrosense_ml catalogue — supervised model output, distinct from risk status above."
            loading={mlLoading && !anyMlData}
            empty={!mlLoading && !anyMlData}
          >
            <div className="mb-3 flex gap-1.5">
              {(["all", "historical", "live"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setMlSource(s)}
                  aria-pressed={mlSource === s}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-medium capitalize transition-colors duration-150 ${
                    mlSource === s
                      ? "bg-accent-primary/15 text-accent-primary"
                      : "text-text-secondary hover:text-text-primary"
                  }`}
                >
                  {s}
                </button>
              ))}
              <span className="ml-auto self-center font-mono text-[10px] text-text-tertiary">
                n = {mlVisible.length}
              </span>
            </div>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={mlFilteredByCategory} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={AXIS} axisLine={{ stroke: GRID }} tickLine={false} allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ ...AXIS, fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={170}
                />
                <ReTooltip contentStyle={tooltipStyle} cursor={{ fill: "#151A20" }} />
                <Bar dataKey="hotspots" radius={[0, 3, 3, 0]} maxBarSize={18}>
                  {mlFilteredByCategory.map((r) => (
                    <Cell key={r.name} fill={r.hex} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      </div>
    </div>
  );
}
