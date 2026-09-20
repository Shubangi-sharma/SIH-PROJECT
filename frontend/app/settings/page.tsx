"use client";

import React, { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Loader2, RefreshCw } from "lucide-react";
import { STATUS_META, STATUS_ORDER } from "@/lib/types";
import { StatusGlyph } from "@/lib/status";
import { FRP_BANDS } from "@/lib/firms";
import {
  fetchBackendHealth,
  fetchMlHealth,
  runPipeline,
  type BackendHealthDto,
  type MlHealthDto,
  type PipelineReport,
} from "@/lib/opsApi";

/** One-line plain-language meaning per risk status (mirrors scoringService). */
const STATUS_HELP: Record<string, string> = {
  normal: "No thermal detections within the 5 km corroboration radius.",
  watch:
    "Detections present but steady — FRP in line with the site's own history.",
  suspicious:
    "New activity in the last 5 days, or FRP ≥ ~1.3× the site's baseline.",
  critical:
    "FRP far above the site's recency-weighted baseline (≥ 2×). Act now.",
  unknown:
    "Detections nearby, but sensor confidence too low to classify.",
};

function Toggle({
  label,
  description,
  defaultOn = false,
}: {
  label: string;
  description: string;
  defaultOn?: boolean;
}) {
  const [on, setOn] = useState(defaultOn);
  return (
    <div className="flex items-center gap-4 border-b border-border-hairline py-4 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm text-text-primary">{label}</p>
        <p className="mt-0.5 text-xs text-text-secondary">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => setOn((v) => !v)}
        className={clsx(
          "relative ml-auto h-6 w-11 flex-shrink-0 rounded-full transition-colors duration-150",
          on ? "bg-accent-primary" : "bg-border-strong",
        )}
      >
        <span
          className={clsx(
            "absolute top-1 h-4 w-4 rounded-full bg-white transition-all duration-150",
            on ? "left-6" : "left-1",
          )}
        />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* system status — the backend/ML ops surfaces that had no UI before   */
/* ------------------------------------------------------------------ */

function uptimeLabel(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function timeLabel(iso: string | null): string {
  if (!iso) return "never";
  return `${iso.replace("T", " ").slice(0, 16)} UTC`;
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={clsx(
        "inline-block h-2 w-2 flex-shrink-0 rounded-full",
        ok ? "bg-status-normal" : "bg-status-critical",
      )}
    />
  );
}

/**
 * System status — live service health (GET /health, GET /api/ml/health) and
 * the manual ML-pipeline handle (POST /api/v1/pipeline/run). The pipeline is
 * genuinely long-running (ingest → weather → aggregate → risk → hotspots,
 * backend budget ~10 min); the UI says so instead of pretending.
 */
function SystemStatusSection() {
  const [backend, setBackend] = useState<BackendHealthDto | null>(null);
  const [ml, setMl] = useState<MlHealthDto | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [checking, setChecking] = useState(true);

  const [pipelineDays, setPipelineDays] = useState(10);
  const [pipelineBusy, setPipelineBusy] = useState(false);
  const [pipelineReport, setPipelineReport] = useState<PipelineReport | null>(null);
  const [pipelineError, setPipelineError] = useState<string | null>(null);

  const check = useCallback(async () => {
    setChecking(true);
    setLoadError(false);
    const results = await Promise.allSettled([fetchBackendHealth(), fetchMlHealth()]);
    setBackend(results[0].status === "fulfilled" ? results[0].value : null);
    setMl(results[1].status === "fulfilled" ? results[1].value : null);
    setLoadError(results.every((r) => r.status === "rejected"));
    setChecking(false);
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const triggerPipeline = useCallback(async () => {
    setPipelineBusy(true);
    setPipelineError(null);
    setPipelineReport(null);
    try {
      const report = await runPipeline(pipelineDays);
      setPipelineReport(report);
      void check(); // refresh health panels — the pipeline just wrote new data
    } catch (err) {
      setPipelineError(err instanceof Error ? err.message : "pipeline failed");
    } finally {
      setPipelineBusy(false);
    }
  }, [pipelineDays, check]);

  return (
    <section
      id="system-status"
      className="scroll-mt-4 rounded-xl bg-bg-surface px-5 py-5"
    >
      <div className="flex items-center gap-3">
        <h2 className="font-display text-base font-semibold text-text-primary">
          System status
        </h2>
        <button
          type="button"
          onClick={() => void check()}
          aria-label="Re-check service status"
          className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-text-tertiary transition-colors duration-150 hover:bg-bg-raised hover:text-text-primary"
        >
          <RefreshCw size={14} className={checking ? "animate-spin" : ""} />
        </button>
      </div>

      {loadError && !backend && !ml ? (
        <p className="mt-3 rounded-lg border border-border-strong bg-bg-raised px-3 py-2 text-xs text-status-watch">
          Backend unreachable at the configured API base URL — is the Node
          backend running (default http://localhost:4000)?
        </p>
      ) : (
        <div className="mt-4 grid gap-3">
          {/* backend card */}
          <div className="rounded-lg border border-border-hairline bg-bg-raised p-4">
            <div className="flex items-center gap-2">
              <StatusDot ok={backend?.status === "ok"} />
              <span className="text-sm font-medium text-text-primary">Node backend</span>
              <span className="ml-auto font-mono text-[11px] text-text-tertiary">
                {backend ? `up ${uptimeLabel(backend.uptimeSec)}` : "unreachable"}
              </span>
            </div>
            {backend ? (
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                <span className="text-text-tertiary">Detections stored</span>
                <span className="text-right font-mono text-text-secondary">
                  {backend.db.rows.toLocaleString("en-IN")}
                </span>
                <span className="text-text-tertiary">Archive window</span>
                <span className="text-right font-mono text-text-secondary">
                  {backend.db.minDate ?? "—"} → {backend.db.maxDate ?? "—"}
                </span>
                <span className="text-text-tertiary">Last FIRMS refresh</span>
                <span className="text-right font-mono text-text-secondary">
                  {timeLabel(backend.lastRefresh)}
                </span>
                <span className="text-text-tertiary">Last facility ingest</span>
                <span className="text-right font-mono text-text-secondary">
                  {timeLabel(backend.lastFacilityIngest)}
                </span>
              </div>
            ) : (
              <p className="mt-2 text-xs text-text-tertiary">No response from /health.</p>
            )}
          </div>

          {/* ML card */}
          <div className="rounded-lg border border-border-hairline bg-bg-raised p-4">
            <div className="flex items-center gap-2">
              <StatusDot ok={ml?.model_loaded === true && ml?.postgres_connected === true} />
              <span className="text-sm font-medium text-text-primary">ML service (pyrosense_ml)</span>
              <span className="ml-auto font-mono text-[11px] text-text-tertiary">
                {ml ? `schema v${ml.feature_schema_version}` : "unreachable"}
              </span>
            </div>
            {ml ? (
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
                <span className="text-text-tertiary">Models loaded</span>
                <span className="text-right font-mono text-text-secondary">
                  {ml.model_loaded ? (ml.classifiers_available ?? ["mlp"]).join(", ") : "no"}
                </span>
                <span className="text-text-tertiary">Postgres connected</span>
                <span className="text-right font-mono text-text-secondary">
                  {ml.postgres_connected ? "yes" : "no"}
                </span>
                <span className="text-text-tertiary">Feature schema</span>
                <span className="text-right font-mono text-text-secondary">
                  {ml.feature_count} features
                </span>
                <span className="text-text-tertiary">Model / dataset</span>
                <span className="text-right font-mono text-text-secondary">
                  v{ml.model_version} / v{ml.dataset_version}
                </span>
              </div>
            ) : (
              <p className="mt-2 text-xs text-text-tertiary">
                No response from /api/ml/health — predictions, risk signals and
                hotspot clusters are unavailable until it is running.
              </p>
            )}
          </div>
        </div>
      )}

      {/* manual pipeline trigger */}
      <div className="mt-4 rounded-lg border border-border-hairline bg-bg-raised p-4">
        <h3 className="text-sm font-medium text-text-primary">ML pipeline</h3>
        <p className="mt-1 text-xs leading-relaxed text-text-secondary">
          Ingests recent FIRMS detections, fetches weather, aggregates H3
          cells, and scores GRU risk + hotspot clusters. Long-running — up to
          ~10 minutes. The Node backend also triggers it on a cron schedule.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label
            htmlFor="pipeline-days"
            className="text-[11px] uppercase tracking-wider text-text-tertiary"
          >
            Window
          </label>
          <select
            id="pipeline-days"
            value={pipelineDays}
            onChange={(e) => setPipelineDays(Number(e.target.value))}
            disabled={pipelineBusy}
            className="rounded-lg border border-border-hairline bg-bg-void px-2 py-1.5 font-mono text-xs text-text-primary"
          >
            {[3, 7, 10, 21, 30].map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void triggerPipeline()}
            disabled={pipelineBusy}
            className={clsx(
              "ml-auto flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition-colors duration-150",
              pipelineBusy
                ? "cursor-wait bg-bg-void text-text-tertiary"
                : "bg-accent-primary text-bg-void hover:opacity-90",
            )}
          >
            {pipelineBusy && <Loader2 size={13} className="animate-spin" />}
            {pipelineBusy ? "Pipeline running — this can take minutes…" : "Run pipeline now"}
          </button>
        </div>
        {pipelineBusy && (
          <p className="mt-2 text-[11px] text-text-tertiary">
            Keep this tab open; the report appears when the backend finishes.
          </p>
        )}
        {pipelineError && (
          <p className="mt-2 rounded-lg border border-border-strong bg-bg-void px-3 py-2 text-xs text-status-watch">
            {pipelineError}
          </p>
        )}
        {pipelineReport && (
          <div className="mt-3">
            <p className="text-[11px] uppercase tracking-wider text-text-tertiary">
              Pipeline report
            </p>
            <pre className="pyro-scroll mt-1.5 max-h-48 overflow-auto rounded-lg bg-bg-void p-3 font-mono text-[10px] leading-relaxed text-text-secondary">
              {JSON.stringify(pipelineReport, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </section>
  );
}

export default function SettingsPage() {
  return (
    <div className="pyro-scroll h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[720px] flex-col gap-6 p-6 pb-20">
        <header className="pt-4">
          <h1 className="font-display text-2xl font-semibold text-text-primary">
            Settings
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Workspace and monitoring preferences
          </p>
        </header>

        <section className="rounded-xl bg-bg-surface px-5 py-2">
          <Toggle
            label="Critical incident notifications"
            description="Bell badge and banner for new critical classifications"
            defaultOn
          />
          <Toggle
            label="Timeline auto-replay"
            description="Start timeline replay automatically when the map loads"
          />
          <Toggle
            label="Unfiltered satellite tiles"
            description="Always render satellite imagery without the dark filter"
            defaultOn
          />
          <Toggle
            label="Low-bandwidth tile mode"
            description="Reduce tile refresh rate on constrained links"
          />
        </section>

        {/* ---------------- system status (live ops) ---------------- */}
        <SystemStatusSection />

        {/* ---------------- how to read this map ---------------- */}
        <section
          id="how-to-read"
          className="scroll-mt-4 rounded-xl bg-bg-surface px-5 py-5"
        >
          <h2 className="font-display text-base font-semibold text-text-primary">
            How to read this map
          </h2>

          {/* risk statuses */}
          <h3 className="mt-4 text-[11px] font-semibold uppercase tracking-widest text-text-tertiary">
            Risk statuses
          </h3>
          <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">
            Every monitored facility is classified by comparing its recent
            thermal detections (last 10 days, within 5 km) against its own
            recency-weighted historical baseline — never against other sites.
          </p>
          <div className="mt-3 grid gap-2.5">
            {STATUS_ORDER.map((s) => (
              <div key={s} className="flex items-start gap-2.5">
                <StatusGlyph status={s} size={10} className="mt-0.5 flex-shrink-0" />
                <p className="text-xs leading-snug text-text-secondary">
                  <span
                    className="font-semibold"
                    style={{ color: STATUS_META[s].hex }}
                  >
                    {STATUS_META[s].label}
                  </span>{" "}
                  — {STATUS_HELP[s]}
                </p>
              </div>
            ))}
          </div>

          {/* FRP */}
          <h3 className="mt-5 text-[11px] font-semibold uppercase tracking-widest text-text-tertiary">
            Thermal hotspots &amp; FRP
          </h3>
          <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">
            Glowing dots are raw active-fire detections from NASA FIRMS (VIIRS
            375 m, last 10 days). Their colour and size encode Fire Radiative
            Power (FRP) — the fire&apos;s radiant heat output in megawatts. Higher
            FRP means a bigger or hotter fire; a cluster persisting across days
            signals sustained activity rather than a one-off burn.
          </p>
          <div className="mt-3 grid gap-2.5">
            {FRP_BANDS.map((band) => (
              <div key={band.label} className="flex items-center gap-2.5">
                <span
                  className="inline-block h-[10px] w-[10px] flex-shrink-0 rounded-full"
                  style={{ backgroundColor: band.color }}
                />
                <span className="font-mono text-xs text-text-secondary">
                  {band.label}
                </span>
              </div>
            ))}
          </div>

          {/* health score */}
          <h3 className="mt-5 text-[11px] font-semibold uppercase tracking-widest text-text-tertiary">
            Thermal Health Score
          </h3>
          <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">
            The 0–100 ring on each facility (100 = quiet) summarises detection
            frequency, FRP magnitude, stability, recency and trend vs baseline
            into one number. Click any marker on the map for the full breakdown.
          </p>
        </section>
      </div>
    </div>
  );
}
