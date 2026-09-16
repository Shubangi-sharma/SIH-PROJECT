"use client";

/**
 * Compare page (Track D) — side-by-side view of 2–3 pinned facilities.
 *
 * Every number is the backend's computed classification (same /api/analyses
 * + /api/facilities/:id/analyses endpoints the rest of the app uses); the
 * FRP trend chart is built from the facility's real stored detections (same
 * /api/firms source as the map). Risk Status here is the monitoring
 * vocabulary — never mixed with the ML Predicted Hotspot Category.
 *
 * The pinned selection lives in lib/compare.ts (localStorage) so pins made
 * anywhere in the app survive the navigation here.
 */

import React, { useMemo } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { GitCompareArrows, Loader2, MapPin, X } from "lucide-react";
import { useAnalyses, useFirms } from "@/lib/hooks";
import { fetchFacilityAnalysis } from "@/lib/api";
import type { WhatChangedRowDto } from "@/lib/api";
import { useCompareIds } from "@/lib/compare";
import { INDIA_BBOX } from "@/lib/regions";
import { StatusBadge, StatusGlyph } from "@/lib/status";
import { RiskStatus, STATUS_META } from "@/lib/types";
import { haversineKm } from "@/lib/geo";
import type { FirmsHotspot } from "@/lib/firms";

const AXIS = { fill: "#78808C", fontSize: 11 } as const;
const GRID = "#1A2028";

const tooltipStyle = {
  backgroundColor: "#101418",
  border: "1px solid #1A2028",
  borderRadius: 10,
  fontSize: 12,
  color: "#C6CDD6",
};

/** One pinned facility: classification + what-changed + FRP trend. */
interface CompareColumn {
  facilityId: string;
  facility: { id: string; name: string; type: string };
  status: RiskStatus;
  score: number;
  detectionCount: number;
  liveMeanFrp: number | null;
  baselineMeanFrp: number | null;
  latestFrp: number | null;
  whatChanged: WhatChangedRowDto[];
}

const COMPARE_COLORS = ["#6E93BE", "#B99B5E", "#9186C4"];

export default function ComparePage() {
  const { ids, hydrated, remove, clear } = useCompareIds();
  const { analyses, isLoading } = useAnalyses([INDIA_BBOX]);
  const { hotspots, isLoading: firmsLoading } = useFirms([INDIA_BBOX]);

  // Per-facility narratives (What Changed) — fetched once per pinned facility.
  const [narratives, setNarratives] = useState<Record<string, WhatChangedRowDto[]>>({});
  useEffect(() => {
    let cancelled = false;
    for (const id of ids) {
      if (narratives[id]) continue;
      fetchFacilityAnalysis(id)
        .then((r) => {
          if (!cancelled) setNarratives((cur) => ({ ...cur, [id]: r.narrative.whatChanged }));
        })
        .catch(() => {
          if (!cancelled) setNarratives((cur) => ({ ...cur, [id]: [] }));
        });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(",")]);

  // Resolve pinned ids against the analyses list (cheap — already cached by SWR).
  const resolved = useMemo(
    () =>
      ids
        .map((id) => analyses.find((a) => a.facility.id === id))
        .filter((a): a is NonNullable<typeof a> => !!a),
    [ids, analyses],
  );

  // Per-facility real FRP trend (mean FRP per active day, from stored detections).
  const trends = useMemo(() => {
    const map = new Map<string, { day: string; frp: number }[]>();
    for (const a of resolved) {
      const f = a.facility;
      const near = hotspots.filter(
        (h) => haversineKm(f.lat, f.lng, h.latitude, h.longitude) <= 5,
      );
      const byDay = new Map<string, { sum: number; n: number }>();
      for (const h of near) {
        const e = byDay.get(h.acqDate) ?? { sum: 0, n: 0 };
        e.sum += h.frp;
        e.n += 1;
        byDay.set(h.acqDate, e);
      }
      map.set(
        f.id,
        [...byDay.entries()]
          .sort((x, y) => x[0].localeCompare(y[0]))
          .map(([day, v]) => ({ day: day.slice(5), frp: Math.round((v.sum / v.n) * 10) / 10 })),
      );
    }
    return map;
  }, [resolved, hotspots]);

  const chartData = useMemo(() => {
    // Merge per-facility series on the union of days.
    const days = new Set<string>();
    for (const series of trends.values()) for (const p of series) days.add(p.day);
    const sorted = [...days].sort();
    return sorted.map((day) => {
      const row: Record<string, string | number | null> = { day };
      resolved.forEach((a, i) => {
        const series = trends.get(a.facility.id);
        const point = series?.find((p) => p.day === day);
        row[a.facility.name] = point?.frp ?? null;
      });
      return row;
    });
  }, [resolved, trends]);

  if (!hydrated) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 size={18} className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  return (
    <div className="pyro-scroll h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6 p-6 pb-20">
        <header className="pt-4">
          <h1 className="flex items-center gap-2.5 font-display text-2xl font-semibold text-text-primary">
            <GitCompareArrows size={20} className="text-accent-primary" />
            Facility Comparison
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-text-secondary">
            Side-by-side view of pinned facilities — health trend inputs, risk
            status and real FRP behaviour. Pin facilities from the Facility
            Explorer or the map.
          </p>
        </header>

        {ids.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-text-tertiary">
              {resolved.length} of {ids.length} pinned resolved
            </span>
            <button
              type="button"
              onClick={clear}
              className="text-xs font-medium text-accent-primary transition-colors duration-150 hover:text-accent-secondary"
            >
              Clear pins
            </button>
          </div>
        )}

        {isLoading && (
          <div className="flex h-40 items-center justify-center gap-2 text-sm text-text-tertiary">
            <Loader2 size={15} className="animate-spin" />
            Loading classifications…
          </div>
        )}

        {!isLoading && ids.length < 2 && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border-hairline bg-bg-surface/40 p-12 text-center">
            <GitCompareArrows size={22} className="text-text-tertiary" />
            <p className="text-sm text-text-secondary">
              Pin {2 - ids.length} more facilit{ids.length === 1 ? "y" : "ies"} to compare
            </p>
            <p className="max-w-md text-xs leading-relaxed text-text-tertiary">
              Open the Facility Explorer and use the pin button on any facility
              card — select 2 or 3, then return here for the side-by-side view.
            </p>
            <Link
              href="/facilities"
              className="mt-1 rounded-lg border border-border-hairline bg-bg-raised px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors duration-150 hover:border-border-strong hover:text-text-primary"
            >
              <MapPin size={12} className="mr-1.5 inline" />
              Go to Facility Explorer
            </Link>
          </div>
        )}

        {!isLoading && ids.length >= 2 && resolved.length < ids.length && (
          <p className="rounded-lg border border-border-hairline bg-bg-raised px-3 py-2 text-xs text-text-secondary">
            Some pinned facilities are outside the current region window and
            couldn&apos;t be resolved. Clear pins and reselect within the loaded
            region.
          </p>
        )}

        {resolved.length >= 2 && (
          <>
            {/* FRP trend — real stored detections, mean FRP per active day */}
            <section className="rounded-xl bg-bg-surface p-5">
              <h3 className="font-display text-sm font-semibold text-text-primary">
                FRP trend — mean MW per active day (last 10 days)
              </h3>
              <p className="mt-0.5 text-[11px] text-text-tertiary">
                Built from the same stored FIRMS detections the classification
                uses. Gaps = no detections that day.
              </p>
              <div className="mt-4 h-[260px]">
                {firmsLoading ? (
                  <div className="flex h-full items-center justify-center gap-2 text-xs text-text-tertiary">
                    <Loader2 size={14} className="animate-spin" /> Loading detections…
                  </div>
                ) : chartData.length === 0 ? (
                  <div className="flex h-full items-center justify-center px-6 text-center text-xs text-text-tertiary">
                    No detections near any pinned facility in the current
                    window — nothing to plot without real data.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 6, right: 12, bottom: 0, left: -18 }}>
                      <CartesianGrid stroke={GRID} strokeDasharray="3 3" />
                      <XAxis dataKey="day" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
                      <YAxis tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} unit=" MW" />
                      <ReTooltip contentStyle={tooltipStyle} />
                      {resolved.map((a, i) => (
                        <Line
                          key={a.facility.id}
                          type="monotone"
                          dataKey={a.facility.name}
                          stroke={COMPARE_COLORS[i % COMPARE_COLORS.length]}
                          strokeWidth={2}
                          dot={{ r: 2 }}
                          connectNulls
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </section>

            {/* side-by-side columns */}
            <section className="grid gap-4 md:grid-cols-3">
              {resolved.map((a, i) => (
                <CompareCard
                  key={a.facility.id}
                  analysis={a}
                  trend={trends.get(a.facility.id) ?? []}
                  color={COMPARE_COLORS[i % COMPARE_COLORS.length]}
                  onRemove={() => remove(a.facility.id)}
                />
              ))}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

/** One facility's comparison column — all values backend-computed. */
function CompareCard({
  analysis,
  trend,
  color,
  onRemove,
}: {
  analysis: (typeof useAnalyses extends never ? never : Awaited<ReturnType<typeof Object>>) & {
    facility: { id: string; name: string; type: string; lat: number; lng: number };
    status: RiskStatus;
    score: number;
    detectionCount: number;
    liveMeanFrp: number | null;
    baselineMeanFrp: number | null;
    latestFrp: number | null;
  };
  trend: { day: string; frp: number }[];
  color: string;
  onRemove: () => void;
}) {
  const a = analysis;
  void a;
    <div className="flex flex-col gap-4 rounded-xl bg-bg-surface p-5">
      <div className="flex items-start gap-2">
        <span className="mt-1.5 inline-block h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <div className="min-w-0">
          <Link
            href={`/facilities/${a.facility.id}`}
            className="block truncate font-display text-sm font-semibold text-text-primary transition-colors duration-150 hover:text-accent-primary"
          >
            {a.facility.name}
          </Link>
          <p className="text-xs text-text-secondary">{a.facility.type}</p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Unpin ${a.facility.name}`}
          className="ml-auto flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-text-tertiary transition-colors duration-150 hover:text-text-primary"
        >
          <X size={13} />
        </button>
      </div>

      <div className="flex items-center justify-between gap-2">
        <StatusBadge status={a.status} />
        <span className="font-mono text-sm text-text-primary">
          HS {a.score}
          <span className="text-text-tertiary">/100</span>
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg border border-border-hairline bg-bg-inset px-2.5 py-2">
          <div className="text-[9px] uppercase tracking-wider text-text-tertiary">Detections (10d)</div>
          <div className="mt-0.5 font-mono text-text-primary">{a.detectionCount}</div>
        </div>
        <div className="rounded-lg border border-border-hairline bg-bg-inset px-2.5 py-2">
          <div className="text-[9px] uppercase tracking-wider text-text-tertiary">Live mean FRP</div>
          <div className="mt-0.5 font-mono text-text-primary">
            {a.liveMeanFrp != null ? `${a.liveMeanFrp.toFixed(1)} MW` : "—"}
          </div>
        </div>
        <div className="rounded-lg border border-border-hairline bg-bg-inset px-2.5 py-2">
          <div className="text-[9px] uppercase tracking-wider text-text-tertiary">Baseline FRP</div>
          <div className="mt-0.5 font-mono text-text-primary">
            {a.baselineMeanFrp != null ? `${a.baselineMeanFrp.toFixed(1)} MW` : "—"}
          </div>
        </div>
        <div className="rounded-lg border border-border-hairline bg-bg-inset px-2.5 py-2">
          <div className="text-[9px] uppercase tracking-wider text-text-tertiary">Latest FRP</div>
          <div className="mt-0.5 font-mono text-text-primary">
            {a.latestFrp != null ? `${a.latestFrp.toFixed(1)} MW` : "—"}
          </div>
        </div>
      </div>

      {/* mini FRP trend */}
      <div className="h-[110px]">
        {trend.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-[11px] text-text-tertiary">
            No detections in window
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trend} margin={{ top: 4, right: 0, bottom: 0, left: -30 }}>
              <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="day" tick={{ fill: "#525A66", fontSize: 9 }} tickLine={false} axisLine={{ stroke: GRID }} />
              <YAxis tick={{ fill: "#525A66", fontSize: 9 }} tickLine={false} axisLine={{ stroke: GRID }} />
              <ReTooltip contentStyle={tooltipStyle} />
              <Bar dataKey="frp" fill={color} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* what changed — real computed diffs, shared component */}
      <WhatChangedMini rows={a.whatChangedRows ?? []} />
    </div>
  );
}

/** Compact what-changed list (real backend rows). */
function WhatChangedMini({ rows }: { rows: WhatChangedRowDto[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-border-hairline bg-bg-raised px-2.5 py-2 text-[11px] text-text-secondary">
        No change signals computed for this facility yet.
      </p>
    );
  }
  return (
    <ul className="space-y-1.5">
      {rows.slice(0, 4).map((r, i) => (
        <li key={i} className="flex items-start gap-1.5 text-[11px] leading-snug">
          <StatusGlyph
            status={(r.severity ?? (r.kind === "ok" ? "normal" : "watch")) as RiskStatus}
            size={7}
            className="mt-1 flex-shrink-0"
          />
          <span className="text-text-secondary">{r.text}</span>
          {r.value && (
            <span className="ml-auto flex-shrink-0 pl-1 font-mono text-text-primary">{r.value}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
