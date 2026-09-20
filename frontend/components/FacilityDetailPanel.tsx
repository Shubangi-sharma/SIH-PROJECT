"use client";

import React from "react";
import { X, Satellite, ShieldAlert, Activity, TrendingUp } from "lucide-react";
import { FacilityAnalysis, RiskStatus, FacilityNarrative, statusColorHex, CLASSIFICATION_LABELS, ThermalClassification } from "@/lib/types";
import { StatusBadge, StatusGlyph } from "@/lib/status";
import HealthScoreRing from "@/components/HealthScoreRing";
import WhatChangedPanel from "@/components/WhatChangedPanel";
import AiSummaryBlock from "@/components/AiSummaryBlock";
import IncidentTimeline from "@/components/IncidentTimeline";
import clsx from "clsx";

/** Small mono readout. */
function MonoStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border-hairline bg-bg-inset px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wider text-text-tertiary">
        {label}
      </div>
      <div className="mt-0.5 truncate font-mono text-xs text-text-primary">
        {value}
      </div>
    </div>
  );
}

/** Score badge — prominent number in status color. */
function ScoreBadge({ label, score, status }: { label: string; score: number; status: RiskStatus }) {
  const hex = statusColorHex(status);
  return (
    <div className="flex flex-col items-center gap-1">
      <span
        className="font-display text-2xl font-bold leading-none"
        style={{ color: hex }}
      >
        {score}
      </span>
      <span className="text-[10px] uppercase tracking-wider text-text-tertiary">
        {label}
      </span>
    </div>
  );
}

/** Classification label with icon. */
function ClassificationBadge({ classification }: { classification: string }) {
  const label = CLASSIFICATION_LABELS[classification as ThermalClassification] ?? classification;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border-hairline bg-bg-surface px-2.5 py-1 font-body text-[11px] font-medium text-text-secondary">
      <ShieldAlert size={11} />
      {label}
    </span>
  );
}

export default function FacilityDetailPanel({
  analysis,
  narrative,
  summary,
  riskScore,
  classification,
  timelineActiveIndex,
  onClose,
  onViewSatellite,
  onOpenFullPage,
}: {
  analysis: FacilityAnalysis;
  narrative: FacilityNarrative | null;
  summary: { text: string; provider: string } | null;
  riskScore?: number;
  classification?: string;
  /** Replay (Track B): highlights the timeline step currently shown. */
  timelineActiveIndex?: number | null;
  onClose: () => void;
  onViewSatellite: () => void;
  onOpenFullPage: () => void;
}) {
  const statusForRisk: RiskStatus =
    riskScore != null
      ? riskScore > 75
        ? "critical"
        : riskScore > 50
          ? "suspicious"
          : riskScore > 25
            ? "watch"
            : "normal"
      : analysis.status;

  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <div className="flex items-start gap-3 border-b border-border-hairline p-5">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold leading-snug text-text-primary">
            {analysis.facility.name}
          </h2>
          <p className="mt-0.5 text-xs text-text-secondary">
            {analysis.facility.type} · {analysis.facility.source === "user_dataset" ? "User Dataset" : "OSM"} {analysis.facility.id.replace("osm-", "")}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={analysis.status} />
            {classification && <ClassificationBadge classification={classification} />}
            {analysis.detectionCount > 0 && (
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent-secondary"
                style={{ backgroundColor: "rgba(6,182,212,0.14)" }}
              >
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent-secondary" />
                FIRMS-confirmed
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close facility detail"
          className="ml-auto flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-text-tertiary transition-colors duration-150 hover:bg-bg-raised hover:text-text-primary"
        >
          <X size={16} />
        </button>
      </div>

      {/* body */}
      {narrative ? (
        <div className="pyro-scroll flex-1 space-y-5 overflow-y-auto p-5">
          {/* dual score badges + telemetry */}
          <div className="flex items-center gap-5 rounded-xl bg-bg-surface p-5">
            <div className="flex items-center gap-6">
              <HealthScoreRing score={analysis.score} status={analysis.status as RiskStatus} />
              {riskScore != null && (
                <div className="flex flex-col items-center gap-1">
                  <div className="relative flex h-[80px] w-[80px] items-center justify-center">
                    <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 80 80">
                      <circle cx="40" cy="40" r="34" fill="none" stroke="currentColor" strokeWidth="4" className="text-bg-raised" />
                      <circle
                        cx="40" cy="40" r="34"
                        fill="none"
                        stroke={statusColorHex(statusForRisk)}
                        strokeWidth="4"
                        strokeLinecap="round"
                        strokeDasharray={`${(riskScore / 100) * 213.6} 213.6`}
                      />
                    </svg>
                    <TrendingUp size={18} style={{ color: statusColorHex(statusForRisk) }} />
                  </div>
                  <span className="font-display text-lg font-bold" style={{ color: statusColorHex(statusForRisk) }}>
                    {riskScore}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-text-tertiary">Risk</span>
                </div>
              )}
            </div>
            <div className="ml-auto grid w-[140px] grid-cols-1 gap-2">
              <MonoStat label="Type" value={analysis.facility.type} />
              <MonoStat
                label="Coordinates"
                value={`${analysis.facility.lat.toFixed(2)}°, ${analysis.facility.lng.toFixed(2)}°`}
              />
              <MonoStat
                label="FRP (latest)"
                value={analysis.latestFrp != null ? `${analysis.latestFrp.toFixed(1)} MW` : "no detection"}
              />
              <MonoStat
                label="Detections"
                value={String(analysis.detectionCount)}
              />
            </div>
          </div>

          {analysis.detectionCount === 0 && (
            <p className="rounded-lg border border-border-hairline bg-bg-raised px-3 py-2 text-xs text-text-secondary">
              No thermal activity detected — this facility sits in a quiet
              region of the current FIRMS window.
            </p>
          )}

          <button
            type="button"
            onClick={onViewSatellite}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-border-hairline bg-bg-raised py-2.5 text-xs font-medium text-text-secondary transition-colors duration-150 hover:border-border-strong hover:text-text-primary"
          >
            <Satellite size={14} />
            View satellite
          </button>

          <WhatChangedPanel rows={narrative.whatChanged} />
          <AiSummaryBlock text={summary?.text ?? "Generating grounded summary…"} provider={summary?.provider} />
          <IncidentTimeline
            events={narrative.timeline}
            activeIndex={timelineActiveIndex}
          />

          <button
            type="button"
            onClick={onOpenFullPage}
            className="w-full rounded-lg py-1 text-center text-xs font-medium text-accent-primary transition-colors duration-150 hover:text-accent-secondary"
          >
            Open full facility page →
          </button>
        </div>
      ) : (
        <div className="pyro-scroll flex-1 space-y-5 overflow-y-auto p-5" aria-hidden>
          <div className="flex items-center gap-5 rounded-xl bg-bg-surface p-5">
            <div className="h-[120px] w-[120px] animate-pulse rounded-full bg-bg-raised" />
            <div className="ml-auto grid w-[150px] grid-cols-1 gap-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-11 animate-pulse rounded-lg bg-bg-raised" />
              ))}
            </div>
          </div>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-bg-surface" />
          ))}
        </div>
      )}
    </div>
  );
}
