"use client";

/**
 * Analytics — distribution charts from the backend's stored FIRMS archive
 * and ML hotspot catalogue. No estimates, no mock data.
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  Cell,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  PieChart,
  Pie,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
  Area,
  AreaChart,
} from "recharts";
import { Activity, BarChart3, Flame, Layers, PieChart as PieIcon, TrendingUp, Zap } from "lucide-react";
import PyroLoader from "@/components/PyroLoader";
import { useAnalyses, useFirms, useMlHotspots } from "@/lib/hooks";
import {
  MODEL_CLASSES,
  MODEL_CLASS_LABELS,
  MODEL_CLASS_COLORS,
} from "@/lib/mlApi";
import {
  fetchHotspotClusters,
  type HotspotClustersResponse,
} from "@/lib/opsApi";
import { HOTSPOT_CLASS_LABELS } from "@/lib/riskApi";
import { STATUS_META, STATUS_ORDER } from "@/lib/types";
import { INDIA_STATE_BBOXES, stateForPoint, type BBox } from "@/lib/regions";
import { frpColor } from "@/lib/firms";

const INDIA_BBOX: BBox = { north: 37.1, south: 6.7, west: 68.1, east: 97.4 };
const AXIS = { fill: "#7E8A9A", fontSize: 11 } as const;
const GRID = "#1F2733";

const tooltipStyle = {
  backgroundColor: "rgba(12, 15, 19, 0.95)",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: 10,
  fontSize: 12,
  color: "#D0D7E0",
  boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
};

/* ── chart card ─────────────────────────────────────────────────────── */

function ChartCard({
  title,
  icon: Icon,
  note,
  loading,
  empty,
  children,
  height = 280,
  className = "",
}: {
  title: string;
  icon?: React.ElementType;
  note?: string;
  loading?: boolean;
  empty?: boolean;
  children: React.ReactNode;
  height?: number;
  className?: string;
}) {
  return (
    <section className={`dash-card rounded-xl p-5 ${className}`}>
      <div className="mb-1 flex items-center gap-2">
        {Icon && <Icon size={14} className="text-text-tertiary" />}
        <h3 className="font-display text-sm font-semibold text-text-primary">{title}</h3>
      </div>
      {note && <p className="mb-3 text-[11px] leading-relaxed text-text-tertiary">{note}</p>}
      <div style={{ height }}>
        {loading ? (
          <div className="skeleton-shimmer h-full w-full rounded-lg" aria-hidden />
        ) : empty ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-xs text-text-tertiary">
            No data available yet — charts render only real stored observations.
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

/* ── summary stat ───────────────────────────────────────────────────── */

function SummaryStat({ label, value, accent }: { label: string; value: number | string; accent?: string }) {
  return (
    <div className="dash-card rounded-xl px-4 py-3">
      <div className="font-display text-2xl font-semibold" style={{ color: accent ?? "#F0F4F8" }}>
        {value}
      </div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wider text-text-tertiary">{label}</div>
    </div>
  );
}

/* ── page ───────────────────────────────────────────────────────────── */

export default function AnalyticsPage() {
  const { analyses, isLoading: analysesLoading, error: analysesError } = useAnalyses([INDIA_BBOX]);
  const { hotspots, isLoading: firmsLoading } = useFirms([INDIA_BBOX]);
  const { hotspots: mlHotspots, isLoading: mlLoading, error: mlError } = useMlHotspots("all");

  const [mlSource, setMlSource] = useState<"all" | "historical" | "live">("all");

  /* ── summary stats ─────────────────────────────────────────── */
  const totalDetections = hotspots.length;
  const criticalCount = useMemo(() => analyses.filter((a) => a.status === "critical").length, [analyses]);
  const suspiciousCount = useMemo(() => analyses.filter((a) => a.status === "suspicious").length, [analyses]);
  const avgFrp = useMemo(() => {
    if (hotspots.length === 0) return "—";
    return (hotspots.reduce((s, h) => s + h.frp, 0) / hotspots.length).toFixed(1);
  }, [hotspots]);

  /* ── by state (top 12) ─────────────────────────────────────── */
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
      .slice(0, 12);
  }, [analyses]);

  /* ── by risk status ────────────────────────────────────────── */
  const byRiskStatus = useMemo(
    () =>
      STATUS_ORDER.map((s) => ({
        status: STATUS_META[s].label,
        facilities: analyses.filter((a) => a.status === s).length,
        hex: STATUS_META[s].hex,
      })).filter((r) => r.facilities > 0),
    [analyses],
  );

  /* ── detections over time ──────────────────────────────────── */
  const overTime = useMemo(() => {
    const counts = new Map<string, number>();
    for (const h of hotspots) counts.set(h.acqDate, (counts.get(h.acqDate) ?? 0) + 1);
    return [...counts.entries()]
      .map(([date, n]) => ({ date: date.slice(5), detections: n }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [hotspots]);

  /* ── FRP distribution ──────────────────────────────────────── */
  const frpBands = useMemo(() => {
    const bands = { "< 2 MW": 0, "2–10 MW": 0, "> 10 MW": 0 };
    for (const h of hotspots) {
      if (h.frp < 2) bands["< 2 MW"] += 1;
      else if (h.frp < 10) bands["2–10 MW"] += 1;
      else bands["> 10 MW"] += 1;
    }
    return Object.entries(bands).map(([band, n]) => ({ band, detections: n }));
  }, [hotspots]);

  /* ── ML category ───────────────────────────────────────────── */
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

  /* ── clusters ──────────────────────────────────────────────── */
  const [clusters, setClusters] = useState<HotspotClustersResponse | null>(null);
  const [clustersError, setClustersError] = useState<string | null>(null);
  const [clustersLoading, setClustersLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setClustersLoading(true);
    setClustersError(null);
    fetchHotspotClusters({
      minLat: INDIA_BBOX.south, maxLat: INDIA_BBOX.north,
      minLng: INDIA_BBOX.west, maxLng: INDIA_BBOX.east,
      limit: 2000,
    })
      .then((r) => { if (!cancelled) setClusters(r); })
      .catch((err: unknown) => {
        if (!cancelled) setClustersError(err instanceof Error ? err.message : "unavailable");
      })
      .finally(() => { if (!cancelled) setClustersLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const clusterList = useMemo(() => clusters?.hotspots ?? [], [clusters]);
  const persistentCount = useMemo(() => clusterList.filter((h) => h.is_persistent).length, [clusterList]);
  const needsReviewCount = useMemo(() => clusterList.filter((h) => h.needs_review).length, [clusterList]);
  const clustersByClass = useMemo(
    () =>
      (clusters?.classes ?? []).map((cls) => ({
        name: HOTSPOT_CLASS_LABELS[cls] ?? cls,
        clusters: clusterList.filter((h) => h.class === cls).length,
      })),
    [clusters, clusterList],
  );
  const anyClusterData = clusterList.length > 0;

  const loading = analysesLoading && analyses.length === 0;
  const initialLoad = loading && firmsLoading && hotspots.length === 0;

  /* Full-screen loader only on a cold start: no data has arrived from any
     source yet. Once anything is cached, charts stream in progressively. */
  if (initialLoad) {
    return (
      <div className="flex h-full items-center justify-center bg-gradient-mesh">
        <PyroLoader
          label="Compiling analytics"
          sub="Crunching the stored FIRMS archive and ML catalogues — first load takes a moment"
        />
      </div>
    );
  }

  return (
    <div className="pyro-scroll h-full overflow-y-auto bg-gradient-mesh">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-5 p-5 pb-20 lg:p-6">
        {/* header */}
        <header className="pt-3">
          <div className="flex items-center gap-2">
            <BarChart3 size={18} className="text-accent-primary" />
            <h1 className="font-display text-2xl font-semibold text-text-primary">Analytics</h1>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-text-secondary">
            Charts computed from stored FIRMS observations and ML service
            catalogues — no estimates, no mock data.
          </p>
          {(analysesError || mlError) && (
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border-hairline bg-bg-surface/50 px-3 py-2 text-xs text-text-secondary">
              <Zap size={12} className="text-status-watch" aria-hidden />
              <span>
                {analysesError ? "Backend analyses " : "ML hotspot catalogue "}
                <span className="text-status-watch">offline</span>
                {analysesError && mlError ? " — both sources " : " — "}
                charts fill in as each source responds.
              </span>
            </p>
          )}
        </header>

        {/* ── summary metrics ──────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[{"label":"VIIRS Detections (10d)","value":loading ? "—" : totalDetections,"accent":"#5B9BD5"},{"label":"Critical Facilities","value":loading ? "—" : criticalCount,"accent":"#E06060"},{"label":"Suspicious Facilities","value":loading ? "—" : suspiciousCount,"accent":"#E08A52"},{"label":"Avg FRP (MW)","value":loading ? "—" : avgFrp,"accent":"#4FB3B3"}].map((s) => (
            <div key={s.label} className="dash-card rounded-xl px-4 py-3">
              <div
                className={`font-display text-2xl font-semibold ${loading ? "animate-pulse" : ""}`}
                style={{ color: s.accent }}
              >
                {s.value}
              </div>
              <div className="mt-0.5 text-[10px] uppercase tracking-wider text-text-tertiary">{s.label}</div>
            </div>
          ))}
        </div>

        {/* ── top row: detection trend + risk donut ─────────────────── */}
        <div className="grid gap-5 lg:grid-cols-[1fr_400px]">
          <ChartCard
            title="Detection Trend"
            icon={TrendingUp}
            note="Daily VIIRS acquisitions over the 10-day rolling window."
            loading={firmsLoading && hotspots.length === 0}
            empty={!firmsLoading && overTime.length === 0}
            height={260}
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={overTime} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                <defs>
                  <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4FB3B3" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#4FB3B3" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={AXIS} axisLine={{ stroke: GRID }} tickLine={false} />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
                <ReTooltip contentStyle={tooltipStyle} />
                <Area
                  type="monotone"
                  dataKey="detections"
                  stroke="#4FB3B3"
                  strokeWidth={2}
                  fill="url(#areaGrad)"
                  dot={false}
                  activeDot={{ r: 3, fill: "#4FB3B3" }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="Risk Distribution"
            icon={PieIcon}
            note="Rule-based monitoring status (Normal → Critical)."
            loading={loading}
            empty={!analysesLoading && analyses.length === 0}
            height={260}
          >
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={byRiskStatus}
                  dataKey="facilities"
                  nameKey="status"
                  innerRadius={55}
                  outerRadius={95}
                  paddingAngle={2}
                  stroke="transparent"
                >
                  {byRiskStatus.map((r) => (
                    <Cell key={r.status} fill={r.hex} />
                  ))}
                </Pie>
                <Legend wrapperStyle={{ fontSize: 11, color: "#7E8A9A" }} />
                <ReTooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {/* ── mid row: state breakdown + FRP bands ─────────────────── */}
        <div className="grid gap-5 lg:grid-cols-2">
          <ChartCard
            title="Top States by Active Facilities"
            icon={BarChart3}
            note="Facilities with ≥1 detection in the live window."
            loading={loading}
            empty={byState.length === 0}
            height={320}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={byState}
                layout="vertical"
                margin={{ top: 4, right: 16, bottom: 0, left: 8 }}
              >
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={AXIS} axisLine={{ stroke: GRID }} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="state" tick={AXIS} axisLine={false} tickLine={false} width={120} />
                <ReTooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.02)" }} />
                <Bar dataKey="facilities" fill="#5B9BD5" radius={[0, 4, 4, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="Fire Radiative Power Distribution"
            icon={Flame}
            note="FRP bands — same gradient as the map markers."
            loading={firmsLoading && hotspots.length === 0}
            empty={!firmsLoading && hotspots.length === 0}
            height={320}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={frpBands} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="band" tick={AXIS} axisLine={{ stroke: GRID }} tickLine={false} />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
                <ReTooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.02)" }} />
                <Bar dataKey="detections" radius={[4, 4, 0, 0]} maxBarSize={56}>
                  {frpBands.map((r) => (
                    <Cell key={r.band} fill={frpColor(r.band === "< 2 MW" ? 1 : r.band === "2–10 MW" ? 5 : 50)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {/* ── ML categories + cluster overview ─────────────────────── */}
        <div className="grid gap-5 lg:grid-cols-2">
          <ChartCard
            title="ML Predicted Categories"
            icon={Layers}
            note="Supervised MLP model output — distinct from rule-based risk status."
            loading={mlLoading && !anyMlData}
            empty={!mlLoading && !anyMlData}
            height={300}
          >
            <div className="mb-3 flex items-center gap-1.5">
              {(["all", "historical", "live"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setMlSource(s)}
                  aria-pressed={mlSource === s}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-medium capitalize transition-colors ${
                    mlSource === s
                      ? "bg-accent-primary/15 text-accent-primary"
                      : "text-text-tertiary hover:text-text-secondary"
                  }`}
                >
                  {s}
                </button>
              ))}
              <span className="ml-auto font-mono text-[10px] text-text-tertiary">
                n = {mlVisible.length}
              </span>
            </div>
            <ResponsiveContainer width="100%" height="85%">
              <BarChart data={mlFilteredByCategory} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
                <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={AXIS} axisLine={{ stroke: GRID }} tickLine={false} allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ ...AXIS, fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={160}
                />
                <ReTooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.02)" }} />
                <Bar dataKey="hotspots" radius={[0, 4, 4, 0]} maxBarSize={18}>
                  {mlFilteredByCategory.map((r) => (
                    <Cell key={r.name} fill={r.hex} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="Hotspot Clusters"
            icon={Activity}
            note="H3-aggregated clusters from the ML pipeline with contextual classification."
            loading={clustersLoading && !anyClusterData}
            empty={!clustersLoading && !anyClusterData && !clustersError}
            height={300}
          >
            {clustersError ? (
              <p className="flex h-full items-center justify-center px-6 text-center text-xs text-text-tertiary">
                Cluster catalogue offline ({clustersError}). Run the ML pipeline from Settings to populate.
              </p>
            ) : (
              <>
                <div className="mb-3 grid grid-cols-3 gap-2">
                  <div className="rounded-lg bg-bg-inset/50 px-3 py-2">
                    <div className="font-display text-lg font-semibold text-text-primary">{clusterList.length}</div>
                    <div className="text-[9px] uppercase tracking-wider text-text-tertiary">clusters</div>
                  </div>
                  <div className="rounded-lg bg-bg-inset/50 px-3 py-2">
                    <div className="font-display text-lg font-semibold text-status-watch">{persistentCount}</div>
                    <div className="text-[9px] uppercase tracking-wider text-text-tertiary">persistent</div>
                  </div>
                  <div className="rounded-lg bg-bg-inset/50 px-3 py-2">
                    <div className="font-display text-lg font-semibold text-status-critical">{needsReviewCount}</div>
                    <div className="text-[9px] uppercase tracking-wider text-text-tertiary">review</div>
                  </div>
                </div>
                {anyClusterData && (
                  <ResponsiveContainer width="100%" height={170}>
                    <BarChart data={clustersByClass} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
                      <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" tick={AXIS} axisLine={{ stroke: GRID }} tickLine={false} allowDecimals={false} />
                      <YAxis
                        type="category"
                        dataKey="name"
                        tick={{ ...AXIS, fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                        width={160}
                      />
                      <ReTooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.02)" }} />
                      <Bar dataKey="clusters" fill="#5B9BD5" radius={[0, 4, 4, 0]} maxBarSize={16} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
                {clusters?.meta.stale && (
                  <p className="mt-2 text-[10px] text-status-watch">
                    Showing stale cached clusters — ML service unreachable.
                  </p>
                )}
              </>
            )}
          </ChartCard>
        </div>
      </div>
    </div>
  );
}
