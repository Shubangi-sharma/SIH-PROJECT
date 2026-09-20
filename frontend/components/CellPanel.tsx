"use client";

import React, { useEffect, useState } from "react";
import { X, AlertTriangle, Eye } from "lucide-react";
import clsx from "clsx";
import {
  fetchCellDetail,
  HORIZON_LABELS,
  HOTSPOT_CLASS_LABELS,
  RISK_LEVEL_COLORS,
  RISK_LEVEL_LABELS,
  type CellDetailResponse,
  type HotspotClusterDto,
  type RiskHorizon,
} from "@/lib/riskApi";
import FreshnessBadge from "./FreshnessBadge";

/**
 * CellPanel — the PDF §10 "cell click panel": one H3 cell's stored risk
 * signals (1/3/7-day + overall) and its hotspot clusters.
 *
 * Honesty rules baked in (LIMITATIONS.md):
 * - insufficient_history renders as an explicit state, never a blank panel;
 * - needs_review clusters render "Needs Review", never a sixth class;
 * - every section shows the response's data_timestamp (FreshnessBadge);
 * - horizon scores are threshold signals, labelled accordingly.
 */

const HORIZON_ORDER: RiskHorizon[] = ["1day", "3day", "7day"];

function RiskCard({
  horizon,
  entry,
}: {
  horizon: RiskHorizon;
  entry?: { probability: number; level: "HIGH" | "LOW"; threshold: number };
}) {
  if (!entry) {
    return (
      <div className="rounded-lg border border-border-hairline bg-bg-inset px-3 py-2.5">
        <div className="font-mono text-[10px] uppercase tracking-wider text-text-tertiary">
          {HORIZON_LABELS[horizon]}
        </div>
        <div className="mt-1 text-xs text-text-tertiary">no signal</div>
      </div>
    );
  }
  const levelColor = entry.level === "HIGH" ? RISK_LEVEL_COLORS.HIGH : RISK_LEVEL_COLORS.LOW;
  return (
    <div className="rounded-lg border border-border-hairline bg-bg-inset px-3 py-2.5">
      <div className="font-mono text-[10px] uppercase tracking-wider text-text-tertiary">
        {HORIZON_LABELS[horizon]}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="font-mono text-sm text-text-primary">{entry.probability.toFixed(2)}</span>
        <span
          className="rounded-full px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider"
          style={{ color: levelColor, backgroundColor: `${levelColor}22` }}
        >
          {entry.level}
        </span>
      </div>
      <div className="mt-0.5 font-mono text-[9px] text-text-tertiary">
        threshold {entry.threshold.toFixed(2)}
      </div>
    </div>
  );
}

function ClusterRow({ cluster }: { cluster: HotspotClusterDto }) {
  const classLabel = cluster.needs_review
    ? "Needs Review"
    : cluster.class
      ? (HOTSPOT_CLASS_LABELS[cluster.class] ?? cluster.class)
      : "Unclassified";
  return (
    <li className="rounded-lg border border-border-hairline bg-bg-inset px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="truncate text-sm font-medium text-text-primary">{classLabel}</span>
        {cluster.is_persistent && (
          <span className="flex-shrink-0 rounded-full bg-bg-raised px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-text-secondary">
            persistent
          </span>
        )}
        {cluster.needs_review && (
          <span
            className="ml-auto flex flex-shrink-0 items-center gap-1 font-mono text-[9px] uppercase tracking-wider text-status-watch"
            title="Classification confidence below threshold — treat as Needs Review"
          >
            <Eye size={11} /> review
          </span>
        )}
      </div>
      <div className="mt-1 flex items-center gap-3 font-mono text-[10px] text-text-secondary">
        <span>{cluster.unique_fire_days} fire days</span>
        <span>{cluster.total_detections} det</span>
        <span className="ml-auto">
          {cluster.first_seen} → {cluster.last_seen}
        </span>
      </div>
      {cluster.confidence != null && !cluster.needs_review && (
        <div className="mt-0.5 font-mono text-[10px] text-text-tertiary">
          confidence {cluster.confidence.toFixed(2)}
        </div>
      )}
      {cluster.contextual_note && (
        <p className="mt-1 text-[10px] leading-snug text-text-tertiary">{cluster.contextual_note}</p>
      )}
    </li>
  );
}

export default function CellPanel({
  h3Cell,
  onClose,
}: {
  h3Cell: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<CellDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setData(null);
    setError(null);
    setLoading(true);
    let cancelled = false;
    fetchCellDetail(h3Cell)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [h3Cell]);

  const risk = data?.risk;
  const riskOk = risk && risk.status === "ok" ? risk : null;
  const insufficient = risk && risk.status === "insufficient_history";

  return (
    <aside
      aria-label={`H3 cell ${h3Cell} detail`}
      className="pyro-scroll flex h-full w-full max-w-[400px] flex-col overflow-y-auto border-l border-border-hairline bg-bg-base shadow-2xl shadow-black/60"
    >
      {/* header */}
      <div className="flex items-start gap-3 border-b border-border-hairline p-5">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold leading-snug text-text-primary">
            H3 cell
          </h2>
          <p className="mt-0.5 truncate font-mono text-xs text-text-secondary">{h3Cell}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close cell detail"
          className="ml-auto flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-text-tertiary transition-colors duration-150 hover:bg-bg-raised hover:text-text-primary"
        >
          <X size={16} />
        </button>
      </div>

      <div className="space-y-5 p-5">
        {loading && (
          <div className="space-y-3" aria-hidden>
            <div className="h-20 animate-pulse rounded-xl bg-bg-surface" />
            <div className="h-32 animate-pulse rounded-xl bg-bg-surface" />
          </div>
        )}

        {error && (
          <p className="flex items-start gap-2 rounded-lg border border-border-strong bg-bg-void/90 px-3 py-2.5 text-xs text-status-watch">
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
            {error}
          </p>
        )}

        {data && (
          <>
            <FreshnessBadge meta={data.meta} label="Risk as of" className="w-fit" />

            {/* risk signals */}
            {riskOk && (
              <section className="rounded-xl bg-bg-surface p-4">
                <div className="flex items-center gap-2">
                  <h3 className="font-display text-sm font-semibold text-text-primary">
                    Risk signals
                  </h3>
                  <span
                    className={clsx("ml-auto rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider")}
                    style={{
                      color: RISK_LEVEL_COLORS[riskOk.overall] ?? RISK_LEVEL_COLORS.LOW,
                      backgroundColor: `${RISK_LEVEL_COLORS[riskOk.overall] ?? RISK_LEVEL_COLORS.LOW}22`,
                    }}
                  >
                    {RISK_LEVEL_LABELS[riskOk.overall] ?? riskOk.overall}
                  </span>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2">
                  {HORIZON_ORDER.map((h) => (
                    <RiskCard key={h} horizon={h} entry={riskOk.horizons[h]} />
                  ))}
                </div>
                <p className="mt-2.5 text-[10px] leading-snug text-text-tertiary">
                  Threshold signals from the GRU models — not probabilities.
                </p>
              </section>
            )}

            {insufficient && (
              <p className="rounded-lg border border-border-hairline bg-bg-raised px-3 py-2.5 text-xs leading-snug text-text-secondary">
                <span className="font-medium text-text-primary">Insufficient 30-day history</span>{" "}
                for this cell — the risk models need 30 consecutive days of fire
                + weather data, and fabricating a score from less would be
                dishonest. Signals appear once the pipeline accumulates enough
                history.
              </p>
            )}

            {risk && risk.status === "unavailable" && (
              <p className="rounded-lg border border-border-strong bg-bg-void/90 px-3 py-2.5 text-xs text-status-watch">
                {risk.note ?? "Risk service unavailable — showing cached data when available."}
              </p>
            )}

            {/* clusters */}
            <section>
              <h3 className="font-display text-sm font-semibold text-text-primary">
                Hotspot clusters {data.hotspots.length > 0 && `(${data.hotspots.length})`}
              </h3>
              {data.hotspots.length === 0 ? (
                <p className="mt-2 rounded-lg border border-border-hairline bg-bg-raised px-3 py-2.5 text-xs leading-snug text-text-secondary">
                  No persistent hotspot clusters recorded for this cell in the
                  current pipeline window.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {data.hotspots.map((c) => (
                    <ClusterRow key={c.cluster_id} cluster={c} />
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </aside>
  );
}
