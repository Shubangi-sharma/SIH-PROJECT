"use client";

import React, { useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowUpRight, ShieldAlert, TrendingUp } from "lucide-react";
import { FacilityAnalysis, RiskStatus, statusColorHex } from "@/lib/types";
import { useAnalyses, useFirms, useCommand } from "@/lib/hooks";
import { REGION_BBOXES, northOrWestRegion } from "@/lib/regions";
import { StatusBadge, StatusGlyph } from "@/lib/status";
import StatTile from "@/components/StatTile";
import type { MapView } from "@/components/MapInner";

const MapInner = dynamic(() => import("@/components/MapInner"), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full animate-pulse bg-bg-surface/45" aria-hidden />
  ),
});

/** severity rank for sorting (critical first) */
const RANK: Record<RiskStatus, number> = {
  critical: 0,
  suspicious: 1,
  watch: 2,
  unknown: 3,
  normal: 4,
};

const PREVIEW_VIEW: MapView = {
  center: [22.0, 79.0],
  zoom: 5,
  key: "dashboard-preview",
};

/** Skeleton grid matching the six summary tiles. */
function StatSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-[92px] animate-pulse rounded-xl bg-bg-surface" />
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();

  // Backend-computed analyses + stored detections, served via SWR (§7):
  // cached data renders instantly, a background refresh follows. Loading
  // skeletons only on a cold cache.
  const { analyses, isLoading: analysesLoading } = useAnalyses(REGION_BBOXES.india);
  const { hotspots, isLoading: firmsLoading } = useFirms(REGION_BBOXES.india);
  const { command } = useCommand();

  const loading =
    analysesLoading || (firmsLoading && analyses.length === 0);

  const summary = useMemo(
    () => ({
      facilitiesMonitored: command?.facilitiesMonitored ?? analyses.length,
      thermalHotspots: command?.totalHotspots ?? analyses.filter((a) => a.detectionCount > 0).length,
      newAnomalies: command?.newAnomalies ?? analyses.filter((a) => a.status === ("watch" as RiskStatus)).length,
      highRiskIncidents: command?.highRisk ?? analyses.filter((a) => a.status === ("suspicious" as RiskStatus)).length,
      criticalIncidents: command?.critical ?? analyses.filter((a) => a.status === ("critical" as RiskStatus)).length,
    }),
    [analyses, command],
  );

  const handlePreviewSelect = React.useCallback(
    (id: string) => router.push(`/facilities/${id}`),
    [router],
  );

  const top3 = useMemo(
    () =>
      [...analyses]
        .sort((a, b) => RANK[a.status] - RANK[b.status] || a.score - b.score)
        .slice(0, 3),
    [analyses],
  );

  /** Priority list from the command view — risk-ranked with classification. */
  const priorityList = useMemo(
    () => command?.priorityList?.slice(0, 8) ?? [],
    [command],
  );

  /** North / West region counts among hotspot-active facilities (PDF §2). */
  const regionCounts = useMemo(() => {
    const counts = { north: 0, west: 0, other: 0 };
    for (const a of analyses) {
      if (a.detectionCount > 0) counts[northOrWestRegion(a.facility.lat, a.facility.lng)] += 1;
    }
    return counts;
  }, [analyses]);

  /** Rule-based behavioural categories across monitored facilities. */
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of command?.priorityList ?? []) {
      counts.set(f.classificationLabel, (counts.get(f.classificationLabel) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [command]);

  return (
    <div className="pyro-scroll h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6 p-6 pb-20">
        {/* morning-briefing header */}
        <header className="flex items-baseline justify-between pt-4">
          <div>
            <h1 className="font-display text-2xl font-semibold text-text-primary">
              Command Dashboard
            </h1>
            <p className="mt-1 text-sm text-text-secondary">
              India thermal monitoring overview · OSM + NASA FIRMS archive
            </p>
          </div>
          <span className="font-mono text-xs text-text-tertiary">
            VIIRS S-NPP + NOAA-20 · year-grounded baseline
          </span>
        </header>

        {/* six summary stats */}
        <section aria-label="Summary statistics">
          {loading ? (
            <StatSkeleton />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
                <StatTile label="Facilities Monitored" value={summary.facilitiesMonitored} />
                <StatTile label="Thermal Hotspots" value={summary.thermalHotspots} />
                <StatTile label="New Anomalies" value={summary.newAnomalies} toneStatus="watch" />
                <StatTile
                  label="High-Risk Incidents"
                  value={summary.highRiskIncidents}
                  tone="suspicious"
                  toneStatus="suspicious"
                />
                <StatTile
                  label="Critical Incidents"
                  value={summary.criticalIncidents}
                  tone="critical"
                  toneStatus="critical"
                />
                <StatTile
                  label="Detections (10d)"
                  value={hotspots.length}
                  toneStatus={hotspots.length > 0 ? "watch" : "normal"}
                />
              </div>
              {/* PDF §2 regional split — real counts from the analysed bbox */}
              <div className="mt-4 grid grid-cols-3 gap-4">
                <StatTile label="North Region Active" value={regionCounts.north} />
                <StatTile label="West Region Active" value={regionCounts.west} />
                <StatTile label="Other Regions Active" value={regionCounts.other} />
              </div>
            </>
          )}
        </section>

        {/* compact preview map — lightly interactive, calm by default */}
        <section aria-label="Facility map preview" className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between px-1">
            <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-text-secondary">
              Live Overview
            </h2>
            <Link
              href="/map"
              className="group flex items-center gap-1 text-xs font-medium text-accent-primary transition-colors duration-150 hover:text-accent-secondary"
            >
              Open live map
              <ArrowUpRight
                size={13}
                className="transition-transform duration-150 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
              />
            </Link>
          </div>
          <div className="relative h-[420px] overflow-hidden rounded-xl border border-border-hairline">
            <MapInner
              view={PREVIEW_VIEW}
              analyses={analyses}
              selectedId={null}
              onSelect={handlePreviewSelect}
              firmsHotspots={hotspots}
              showFirms
              onSelectHotspot={() => {}}
              onTilesLoading={() => {}}
              onTilesLoaded={() => {}}
              onViewport={() => {}}
            />
          </div>
        </section>

        {/* top 3 facilities needing attention */}
        <section aria-label="Top facilities needing attention" className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between px-1">
            <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-text-secondary">
              Needs Attention
            </h2>
            <Link
              href="/chat"
              className="group flex items-center gap-1 text-xs font-medium text-accent-primary transition-colors duration-150 hover:text-accent-secondary"
            >
              Ask the AI assistant
              <ArrowUpRight
                size={13}
                className="transition-transform duration-150 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
              />
            </Link>
          </div>
          {loading ? (
            <div className="grid gap-4 md:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-[170px] animate-pulse rounded-xl bg-bg-surface" />
              ))}
            </div>
          ) : top3.length === 0 ? (
            <div className="rounded-xl bg-bg-surface p-10 text-center">
              <p className="text-sm text-text-secondary">
                No active thermal anomalies in this region — all monitored sites quiet.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              {top3.map((a: FacilityAnalysis, i) => (
                <Link
                  key={a.facility.id}
                  href={`/facilities/${a.facility.id}`}
                  className="group flex flex-col gap-3 rounded-xl bg-bg-surface p-5 transition-colors duration-150 hover:bg-bg-raised"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-text-tertiary">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <StatusBadge status={a.status} />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="truncate font-display text-base font-semibold text-text-primary">
                      {a.facility.name}
                    </span>
                    <StatusGlyph status={a.status} size={7} className="flex-shrink-0" />
                  </div>
                  <p className="line-clamp-2 text-xs leading-relaxed text-text-secondary">
                    {a.detectionCount > 0
                      ? `${a.detectionCount} FIRMS detection${a.detectionCount === 1 ? "" : "s"} within 5 km in the last 10 days${a.latestFrp != null ? ` · latest ${a.latestFrp.toFixed(1)} MW` : ""}`
                      : "No thermal activity detected in the current window"}
                  </p>
                  <div className="mt-auto flex items-baseline gap-2 pt-1">
                    <span className="font-mono text-sm text-text-primary">
                      HS {a.score}
                    </span>
                    <span className="font-mono text-xs text-text-tertiary">
                      · {a.latestFrp != null ? `${a.latestFrp.toFixed(0)} MW` : "quiet"}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* behavioural category mix — rule-based vocabulary, NOT ML classes */}
        {!loading && categoryCounts.length > 0 && (
          <section aria-label="Category mix" className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between px-1">
              <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-text-secondary">
                Behavioural Category Mix
              </h2>
              <span className="font-mono text-[10px] text-text-tertiary">
                rule-based monitoring classification
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {categoryCounts.map(([label, n]) => (
                <div
                  key={label}
                  className="rounded-xl border border-border-hairline bg-bg-surface px-4 py-3"
                >
                  <div className="font-display text-xl font-semibold text-text-primary">{n}</div>
                  <div className="mt-0.5 text-[11px] uppercase tracking-wide text-text-secondary">
                    {label}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* priority list — risk-ranked with classification */}
        {priorityList.length > 0 && (
          <section aria-label="Priority list" className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between px-1">
              <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-text-secondary">
                Risk-Ranked Priority List
              </h2>
              <span className="font-mono text-[10px] text-text-tertiary">
                sorted by risk score · updated every 30s
              </span>
            </div>
            <div className="overflow-hidden rounded-xl border border-border-hairline bg-bg-surface">
              <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-x-4 border-b border-border-hairline px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-text-tertiary">
                <span>#</span>
                <span>Facility</span>
                <span>Status</span>
                <span>Health</span>
                <span>Risk</span>
                <span>Classification</span>
              </div>
              {priorityList.map((fac, i) => {
                const statusHex = statusColorHex(fac.status as RiskStatus);
                return (
                  <Link
                    key={fac.id}
                    href={`/facilities/${fac.id}`}
                    className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] items-center gap-x-4 border-b border-border-hairline px-4 py-3 transition-colors duration-150 last:border-b-0 hover:bg-bg-raised"
                  >
                    <span className="font-mono text-[11px] text-text-tertiary">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="flex items-center gap-2 min-w-0">
                      <span
                        className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: statusHex }}
                      />
                      <span className="truncate text-sm font-medium text-text-primary">
                        {fac.name}
                      </span>
                      <span className="flex-shrink-0 font-mono text-[10px] text-text-tertiary">
                        {fac.type}
                      </span>
                    </span>
                    <StatusBadge status={fac.status as RiskStatus} />
                    <span className="font-mono text-xs text-text-primary">
                      {fac.healthScore}
                    </span>
                    <span className="flex items-center gap-1">
                      <TrendingUp size={11} style={{ color: statusHex }} />
                      <span className="font-mono text-xs font-semibold" style={{ color: statusHex }}>
                        {fac.riskScore}
                      </span>
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-border-hairline bg-bg-inset px-2 py-0.5 font-body text-[10px] text-text-secondary">
                      <ShieldAlert size={10} />
                      {fac.classificationLabel}
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

