"use client";

import React from "react";
import { Factory, MapPin, Sparkle, X } from "lucide-react";
import FreshnessBadge from "./FreshnessBadge";
import {
  fetchCellDetailByPoint,
  HORIZON_LABELS,
  HOTSPOT_CLASS_LABELS,
  RISK_LEVEL_COLORS,
  RISK_LEVEL_LABELS,
  type CellDetailResponse,
  type HotspotClusterDto,
  type RiskHorizon,
} from "@/lib/riskApi";

/**
 * AreaPanel — what a click on open map shows.
 *
 * The old panel led with a raw H3 cell id ("841f52dfffffffff"), which means
 * nothing to a map reader. Operators still need the cell's stored risk
 * signals, so those stay — but the panel now speaks in plain terms first:
 * whether any monitored facility covers this point, what the area's fire
 * history looks like, and only then the technical detail.
 */

const HORIZON_ORDER: RiskHorizon[] = ["1day", "3day", "7day"];

function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2.5 inline-flex items-center gap-1.5 rounded-md border border-border-hairline bg-bg-raised px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-wider text-text-secondary transition-colors duration-150 hover:border-border-strong hover:text-text-primary"
    >
      Retry
    </button>
  );
}

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
            className="ml-auto flex-shrink-0 font-mono text-[9px] uppercase tracking-wider text-status-watch"
            title="Classification confidence below threshold — treat as Needs Review"
          >
            review
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
    </li>
  );
}

export default function AreaPanel({
  lat,
  lng,
  onClose,
}: {
  lat: number;
  lng: number;
  onClose: () => void;
}) {
  const [data, setData] = useState<CellDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const retry = () => setRefreshKey((k) => k + 1);

  useEffect(() => {
    setData(null);
    setError(null);
    setLoading(true);
    let cancelled = false;
    fetchCellDetailByPoint(lat, lng)
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
  }, [lat, lng, refreshKey]);

  const risk = data?.risk;
  const riskOk = risk && risk.status === "ok" ? risk : null;
  const insufficient = risk && risk.status === "insufficient_history";
  const hasClusters = (data?.hotspots.length ?? 0) > 0;
  const hasSignals = Boolean(riskOk);

  return (
    <aside
      aria-label="Area detail"
      className="flex h-full w-full flex-col overflow-hidden"
    >
      {/* header — plain-language area summary */}
      <div className="flex items-start gap-3 border-b border-border-hairline p-5 pb-4">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold leading-snug text-text-primary">
            {hasClusters ? "Fire activity in this area" : "No monitored facilities here"}
          </h2>
          <p className="mt-0.5 font-mono text-[11px] text-text-tertiary">
            {lat.toFixed(3)}°, {lng.toFixed(3)}°
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close area detail"
          className="ml-auto flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-text-tertiary transition-colors duration-150 hover:bg-bg-raised hover:text-text-primary"
        >
          <X size={16} />
        </button>
      </div>

      <div className="pyro-scroll min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
        {/* plain-language state line */}
        <p className="text-sm leading-relaxed text-text-secondary">
          {hasClusters ? (
            <>
              Thermal activity has been recorded around this point. Details below —
              open a facility marker or hotspot dot for the full picture.
            </>
          ) : (
            <>
              This point sits outside every facility&apos;s{" "}
              <span className="text-text-primary">5 km monitoring radius</span> — no
              industrial fire signatures recorded here in the current window. Most
              likely open terrain, or a source we don&apos;t track.
            </>
          )}
        </p>

        {loading && (
          <div className="space-y-3" aria-hidden>
            <div className="h-20 animate-pulse rounded-xl bg-bg-surface" />
            <div className="h-32 animate-pulse rounded-xl bg-bg-surface" />
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-border-strong bg-bg-void/90 px-3 py-2.5 text-xs text-status-watch">
            <p className="flex items-start gap-2">
              <Sparkle size={14} className="mt-0.5 flex-shrink-0" />
              Risk signals couldn&apos;t be loaded for this area.
            </p>
            <RetryButton onClick={retry} />
          </div>
        )}

        {data && (
          <>
            <FreshnessBadge meta={data.meta} label="Data as of" className="w-fit" />
            {data.meta.stale && (
              <p className="text-[10px] leading-snug text-status-watch">
                Last known good data — the ML service was unreachable when this
                was fetched.
              </p>
            )}

            {/* risk signals */}
            {riskOk && (
              <section className="rounded-xl bg-bg-surface p-4">
                <div className="flex items-center gap-2">
                  <h3 className="font-display text-sm font-semibold text-text-primary">
                    Fire-weather risk outlook
                  </h3>
                  <span
                    className="ml-auto rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider"
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
                Not enough observation history for this area yet — the outlook
                needs 30 consecutive days of fire + weather data. Signals appear
                once the pipeline accumulates enough history.
              </p>
            )}

            {risk && risk.status === "unavailable" && (
              <div className="rounded-lg border border-border-strong bg-bg-void/90 px-3 py-3 text-xs">
                <p className="font-medium text-status-watch">Outlook unavailable</p>
                <p className="mt-1.5 leading-snug text-text-secondary">
                  The forecast models could not be reached.{" "}
                  {risk.note ?? "No stored prediction exists for this area yet."}
                </p>
                <RetryButton onClick={retry} />
              </div>
            )}

            {/* activity clusters — plain framing */}
            <section>
              <h3 className="font-display text-sm font-semibold text-text-primary">
                {hasClusters ? "Recorded activity" : "Recorded activity — none"}
              </h3>
              {data.hotspots.length === 0 ? (
                <p className="mt-2 rounded-lg border border-border-hairline bg-bg-raised px-3 py-2.5 text-xs leading-snug text-text-secondary">
                  No persistent fire clusters recorded for this area in the
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

            {!hasSignals && !hasClusters && !error && (
              <div className="flex items-center gap-2.5 rounded-lg border border-border-hairline bg-bg-raised px-3 py-2.5">
                <Factory size={14} className="flex-shrink-0 text-text-tertiary" />
                <p className="text-[11px] leading-snug text-text-tertiary">
                  Want this area monitored? Facilities are ingested from
                  OpenStreetMap — add industrial sites there and they appear on
                  the next ingest cycle.
                </p>
              </div>
            )}

            <p className="flex items-center gap-1.5 text-[10px] text-text-tertiary">
              <MapPin size={10} aria-hidden />
              Area reference {data.h3_cell}
            </p>
          </>
        )}
      </div>
    </aside>
  );
}
