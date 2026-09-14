"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { ArrowLeft, Satellite } from "lucide-react";
import { StatusBadge } from "@/lib/status";
import HealthScoreRing from "@/components/HealthScoreRing";
import WhatChangedPanel from "@/components/WhatChangedPanel";
import AiSummaryBlock from "@/components/AiSummaryBlock";
import IncidentTimeline from "@/components/IncidentTimeline";
import { fetchFacilityAnalysis, fetchSummary } from "@/lib/api";
import { FacilityNarrative, RiskStatus } from "@/lib/types";
import type { FacilityAnalysisResponseDto, SummaryResponseDto } from "@/lib/api";

const MiniMapInner = dynamic(() => import("@/components/MiniMapInner"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-bg-base" />,
});

function MonoStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border-hairline bg-bg-inset px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-text-tertiary">
        {label}
      </div>
      <div className="mt-0.5 truncate font-mono text-sm text-text-primary">
        {value}
      </div>
    </div>
  );
}

export default function FacilityDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const osmId = params.id;

  // The facility's identity, status and narrative all come from the backend.
  const [analysis, setAnalysis] = useState<FacilityAnalysisResponseDto | null>(null);
  const [summary, setSummary] = useState<SummaryResponseDto | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setAnalysis(null);
    setSummary(null);
    setError(false);

    fetchFacilityAnalysis(osmId)
      .then((r) => {
        if (!cancelled) setAnalysis(r);
        return null;
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    fetchSummary(osmId)
      .then((r) => {
        if (!cancelled) setSummary(r);
        return null;
      })
      .catch(() => {
        /* summary errors are non-fatal — the template fallback is served */
      });

    return () => {
      cancelled = true;
    };
  }, [osmId]);

  const facility = analysis?.facility;
  const status = analysis?.classification.status as RiskStatus | undefined;

  const [satellite, setSatellite] = useState(false);
  useEffect(() => {
    document.title = facility
      ? `${facility.name} — PYROSENSE`
      : "Facility — PYROSENSE";
  }, [facility]);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
        <p className="text-sm text-text-secondary">
          Live facility feed unavailable — retrying automatically.
        </p>
        <Link
          href="/facilities"
          className="text-xs font-medium text-accent-primary hover:text-accent-secondary"
        >
          ← Back to Facility Explorer
        </Link>
      </div>
    );
  }

  if (!analysis || !facility || !status) {
    return (
      <div className="pyro-scroll h-full overflow-y-auto">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-6 p-6 pb-20">
          <div className="h-10 w-56 animate-pulse rounded-lg bg-bg-surface" />
          <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
            <div className="h-[420px] animate-pulse rounded-xl bg-bg-surface" />
            <div className="h-[420px] animate-pulse rounded-xl bg-bg-surface" />
          </div>
        </div>
      </div>
    );
  }

  const narrative: FacilityNarrative = {
    whatChanged: analysis.narrative.whatChanged,
    timeline: analysis.narrative.timeline,
  };
  const c = analysis.classification;

  return (
    <div className="pyro-scroll h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-6 p-6 pb-20">
        {/* header */}
        <header className="flex flex-col gap-3 pt-4">
          <button
            type="button"
            onClick={() => router.back()}
            className="flex w-fit items-center gap-1.5 text-xs text-text-tertiary transition-colors duration-150 hover:text-text-primary"
          >
            <ArrowLeft size={13} />
            Back
          </button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-2xl font-semibold text-text-primary">
              {facility.name}
            </h1>
            <StatusBadge status={status} />
          </div>
          <p className="text-sm text-text-secondary">
            {facility.type} · OpenStreetMap {facility.id.replace("osm-", "")} · status
            computed from the FIRMS archive by the PYROSENSE backend
          </p>
        </header>

        {/* 2-column body */}
        <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
          {/* LEFT: health + locator */}
          <div className="flex flex-col gap-6">
            <section className="flex flex-col items-center gap-5 rounded-xl bg-bg-surface p-6">
              <HealthScoreRing score={c.score} status={status} />
              <div className="grid w-full grid-cols-2 gap-3">
                <MonoStat
                  label="FRP (latest)"
                  value={c.latestFrp != null ? `${c.latestFrp.toFixed(1)} MW` : "no detection"}
                />
                <MonoStat
                  label="Coordinates"
                  value={`${facility.lat.toFixed(2)}°, ${facility.lng.toFixed(2)}°`}
                />
                <MonoStat label="Type" value={facility.type} />
                <MonoStat
                  label="Detections (10d)"
                  value={String(c.detectionCount)}
                />
              </div>
              {c.detectionCount === 0 && (
                <p className="text-center text-xs text-text-secondary">
                  No thermal activity detected within 5 km in the last 10 days.
                </p>
              )}
            </section>

            {/* locator mini-map — switchable to satellite imagery */}
            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between px-1">
                <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-text-secondary">
                  Locator
                </h2>
                <button
                  type="button"
                  onClick={() => setSatellite((s) => !s)}
                  aria-pressed={satellite}
                  className="flex items-center gap-1.5 rounded-md border border-border-hairline bg-bg-surface px-2 py-1 text-[11px] font-medium text-text-secondary transition-colors duration-150 hover:border-border-strong hover:text-text-primary"
                >
                  <Satellite size={12} />
                  {satellite ? "Dark view" : "View satellite"}
                </button>
              </div>
              <div className="h-[280px] overflow-hidden rounded-xl border border-border-hairline">
                <MiniMapInner
                  lat={facility.lat}
                  lng={facility.lng}
                  name={facility.name}
                  satellite={satellite}
                />
              </div>
              <p className="px-1 text-[11px] leading-relaxed text-text-tertiary">
                Satellite imagery renders unfiltered for visual verification of
                thermal signatures.
              </p>
            </section>
          </div>

          {/* RIGHT: narrative stack — computed by the backend, AI grounded in facts */}
          <div className="flex min-w-0 flex-col gap-6">
            <WhatChangedPanel rows={narrative.whatChanged} />
            <AiSummaryBlock
              text={summary?.text ?? "Generating grounded summary…"}
            />
            <IncidentTimeline events={narrative.timeline} />
          </div>
        </div>
      </div>
    </div>
  );
}
