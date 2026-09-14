"use client";

import React, { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import {
  Facility,
  FacilityAnalysis,
  FacilityType,
  RiskStatus,
  STATUS_META,
  STATUS_ORDER,
} from "@/lib/types";
import { useAnalyses } from "@/lib/hooks";
import { REGION_BBOXES } from "@/lib/regions";
import { StatusGlyph } from "@/lib/status";
import clsx from "clsx";

const TYPES: FacilityType[] = [
  "Refinery",
  "Power Plant",
  "Industrial Site",
  "Mine",
];

const SEVERITY_RANK: Record<RiskStatus, number> = {
  critical: 0,
  suspicious: 1,
  watch: 2,
  unknown: 3,
  normal: 4,
};

/** Skeleton card matching the real card layout (design.md, no spinners). */
function CardSkeleton() {
  return (
    <div className="h-[132px] animate-pulse rounded-xl bg-bg-surface" aria-hidden />
  );
}

/**
 * Memoised card — a SWR refresh re-renders only cards whose underlying
 * analysis actually changed (§5).
 */
const FacilityCard = React.memo(function FacilityCard({
  analysis,
}: {
  analysis: FacilityAnalysis;
}) {
  const { facility: f, status } = analysis;
  const hex = STATUS_META[status].hex;
  return (
    <Link
      href={`/facilities/${f.id}`}
      className="group relative flex flex-col gap-3 overflow-hidden rounded-xl bg-bg-surface p-5 transition-colors duration-150 hover:bg-bg-raised"
    >
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-1"
        style={{ backgroundColor: hex }}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-display text-sm font-semibold text-text-primary">
          {f.name}
        </span>
        <StatusGlyph status={status} size={8} className="flex-shrink-0" />
      </div>
      <p className="text-xs text-text-secondary">
        {f.type} · {f.source === "osm" ? "OpenStreetMap" : f.source}
      </p>
      <div className="mt-auto flex items-baseline gap-3 pt-1 font-mono text-xs">
        <span className="text-text-primary">HS {analysis.score}</span>
        <span className="text-text-tertiary">
          {analysis.detectionCount > 0
            ? `${analysis.detectionCount} det`
            : "quiet"}
        </span>
        <span className="ml-auto text-text-tertiary">
          {analysis.latestFrp != null ? `${analysis.latestFrp.toFixed(0)} MW` : "—"}
        </span>
      </div>
    </Link>
  );
});

function FacilitiesBody() {
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [statusFilter, setStatusFilter] = useState<RiskStatus | null>(null);
  const [typeFilter, setTypeFilter] = useState<FacilityType | null>(null);

  const { analyses, isLoading, error } = useAnalyses(REGION_BBOXES.india);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return analyses
      .filter((a) => {
        const f: Facility = a.facility;
        if (statusFilter && a.status !== statusFilter) return false;
        if (typeFilter && f.type !== typeFilter) return false;
        if (q && !`${f.name} ${f.type}`.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort(
        (a, b) => SEVERITY_RANK[a.status] - SEVERITY_RANK[b.status] || a.score - b.score,
      );
  }, [analyses, query, statusFilter, typeFilter]);

  return (
    <div className="pyro-scroll h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-6 p-6 pb-20">
        <header className="pt-4">
          <h1 className="font-display text-2xl font-semibold text-text-primary">
            Facility Explorer
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            {isLoading
              ? "Loading classified facilities…"
              : `${analyses.length} industrial sites from OpenStreetMap · status computed by the PYROSENSE backend`}
          </p>
        </header>

        {/* search + filter bar */}
        <section className="flex flex-col gap-3">
          <div className="relative max-w-md">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search facility or type…"
              className="h-10 w-full rounded-lg border border-border-hairline bg-bg-inset pl-9 pr-3 font-mono text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-accent-primary/60 focus:outline-none focus:ring-1 focus:ring-accent-primary/30"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {STATUS_ORDER.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter((cur) => (cur === s ? null : s))}
                aria-pressed={statusFilter === s}
                className={clsx(
                  "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors duration-150",
                  statusFilter === s
                    ? "border-accent-primary bg-accent-primary/15 text-accent-primary"
                    : "border-border-hairline bg-bg-surface text-text-secondary hover:border-border-strong hover:text-text-primary",
                )}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: STATUS_META[s].hex }}
                />
                {STATUS_META[s].label}
              </button>
            ))}
            <span className="mx-1 h-5 w-px bg-border-hairline" aria-hidden />
            {TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTypeFilter((cur) => (cur === t ? null : t))}
                aria-pressed={typeFilter === t}
                className={clsx(
                  "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors duration-150",
                  typeFilter === t
                    ? "border-accent-primary bg-accent-primary/15 text-accent-primary"
                    : "border-border-hairline bg-bg-surface text-text-secondary hover:border-border-strong hover:text-text-primary",
                )}
              >
                {t}
              </button>
            ))}
          </div>
        </section>

        {/* results */}
        <p className="font-mono text-xs text-text-tertiary">
          {isLoading ? "…" : `${filtered.length} of ${analyses.length} facilities`}
        </p>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {isLoading
            ? Array.from({ length: 8 }).map((_, i) => <CardSkeleton key={i} />)
            : filtered.map((a) => <FacilityCard key={a.facility.id} analysis={a} />)}
        </section>

        {!isLoading && error && (
          <div className="rounded-xl bg-bg-surface p-10 text-center">
            <p className="text-sm text-text-secondary">
              Facility feed unavailable — the backend could not be reached. Retrying
              automatically.
            </p>
          </div>
        )}

        {!isLoading && !error && filtered.length === 0 && (
          <div className="rounded-xl bg-bg-surface p-10 text-center">
            <p className="text-sm text-text-secondary">
              {analyses.length === 0
                ? "No industrial sites returned for this region yet."
                : "No facilities match the current filters"}
            </p>
            {analyses.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setStatusFilter(null);
                  setTypeFilter(null);
                }}
                className="mt-3 text-xs font-medium text-accent-primary hover:text-accent-secondary"
              >
                Clear all filters
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function FacilitiesPage() {
  return (
    <Suspense fallback={null}>
      <FacilitiesBody />
    </Suspense>
  );
}
