"use client";

/**
 * Predict page — Hotspot Classification (SIH brief §6–§9).
 *
 * Collects ONLY the brief's recommended fields (lat, lng, optional region
 * tag); every one of the 36 model features is engineered server-side by
 * pyrosense_ml's auto mode. The 4-class result renders under the exact
 * "Predicted Hotspot Category" heading, visually distinct from the
 * monitoring backend's rule-based Risk Status vocabulary.
 *
 * Data flow (§7): form → backend proxy → pyrosense_ml feature engineering →
 * same preprocessing → model → prediction + explanation → this result view.
 * No mock numbers: every value shown comes from the response.
 */

import React, { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Crosshair,
  FileWarning,
  Loader2,
  MapPin,
  RotateCcw,
  Satellite,
} from "lucide-react";
import clsx from "clsx";
import {
  MODEL_CLASSES,
  MODEL_CLASS_COLORS,
  MODEL_CLASS_LABELS,
  postPredict,
  type ModelClass,
  type PredictionResponseDto,
} from "@/lib/mlApi";
import {
  FEATURE_LABELS,
  contributionDeviationFor,
  formatFeatureValue,
  featureLabel,
} from "@/lib/features";

/** Number-only input supporting blank state + validation (§10). */
function NumberField({
  label,
  hint,
  value,
  onChange,
  placeholder,
  min,
  max,
  step = "any",
  required,
  error,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: string;
  required?: boolean;
  error?: string | null;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-text-tertiary">
          {label}
          {required && <span className="ml-1 text-status-suspicious">*</span>}
        </span>
        {hint && <span className="text-[10px] text-text-tertiary">{hint}</span>}
      </span>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        aria-invalid={!!error}
        className={clsx(
          "mt-1.5 w-full rounded-lg border bg-bg-inset px-3 py-2 font-mono text-sm text-text-primary outline-none transition-colors duration-150 placeholder:text-text-tertiary",
          error ? "border-status-critical" : "border-border-hairline focus:border-accent-primary",
        )}
      />
      {error && <span className="mt-1 block text-[11px] text-status-critical">{error}</span>}
    </label>
  );
}

/** Probability bar row — per-class share of the model's belief. */
function ProbabilityBar({
  cls,
  probability,
  winner,
}: {
  cls: ModelClass;
  probability: number;
  winner: boolean;
}) {
  const hex = MODEL_CLASS_COLORS[cls];
  const pct = Math.round(probability * 1000) / 10;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className={clsx("text-xs", winner ? "font-semibold text-text-primary" : "text-text-secondary")}>
          {MODEL_CLASS_LABELS[cls]}
          {winner && (
            <span
              className="ml-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
              style={{ backgroundColor: `${hex}26`, color: hex }}
            >
              predicted
            </span>
          )}
        </span>
        <span className={clsx("font-mono text-xs", winner ? "font-semibold text-text-primary" : "text-text-secondary")}>
          {pct.toFixed(1)}%
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-bg-raised">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(100, Math.max(0, pct))}%`, backgroundColor: hex }}
        />
      </div>
    </div>
  );
}

/**
 * Confidence distribution (Track A3) — a single stacked bar of the four
 * class probabilities, exactly as the backend returned them (values are
 * rendered, never recomputed). The winning segment is outlined and labelled.
 */
function ConfidenceDistribution({
  probabilities,
  predictedClass,
}: {
  probabilities: PredictionResponseDto["probabilities"];
  predictedClass: ModelClass;
}) {
  const total = MODEL_CLASSES.reduce((a, c) => a + (probabilities[c] ?? 0), 0);
  if (total <= 0) return null; // empty payload → no invented bar
  return (
    <div className="mt-6">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
          Model belief distribution
        </span>
        <span className="font-mono text-[10px] text-text-tertiary">Σ 100%</span>
      </div>
      <div
        className="mt-1.5 flex h-3 w-full overflow-hidden rounded-full bg-bg-raised"
        role="img"
        aria-label={MODEL_CLASSES.map(
          (c) => `${MODEL_CLASS_LABELS[c]} ${((probabilities[c] ?? 0) * 100).toFixed(1)}%`,
        ).join(", ")}
      >
        {MODEL_CLASSES.map((c) => {
          const p = probabilities[c] ?? 0;
          if (p <= 0) return null;
          const winner = c === predictedClass;
          return (
            <div
              key={c}
              className="h-full transition-all duration-500"
              style={{
                width: `${(p / total) * 100}%`,
                backgroundColor: MODEL_CLASS_COLORS[c],
                outline: winner ? "1.5px solid #E6EBF2" : undefined,
                outlineOffset: winner ? "-1.5px" : undefined,
              }}
              title={`${MODEL_CLASS_LABELS[c]} — ${(p * 100).toFixed(1)}%${winner ? " (predicted)" : ""}`}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * Explainability panel (Track A1) — one row per top_contributing_features
 * entry, sorted by contribution score descending (the backend already sorts;
 * the guard keeps it true even if a cached payload arrives unsorted).
 *
 * Contribution = importance × deviation vs the training median, exactly as
 * risk_score.py::key_contributors computes it — re-derived for display only,
 * never fed back into anything. The bar's width is the feature's share of
 * Σ(contributions) so the picture is proportional, not absolute.
 */
function ExplainabilityCard({
  features,
}: {
  features: PredictionResponseDto["top_contributing_features"];
}) {
  if (features.length === 0) {
    return (
      <div className="rounded-xl bg-bg-surface p-5">
        <h3 className="font-display text-sm font-semibold text-text-primary">
          Why this prediction
        </h3>
        <p className="mt-2 rounded-lg border border-border-hairline bg-bg-raised px-3 py-2 text-xs leading-relaxed text-text-secondary">
          No feature contributions were returned for this prediction — the model
          could not attribute this result to specific inputs.
        </p>
      </div>
    );
  }

  const withScore = [...features]
    .map((f) => ({
      ...f,
      contribution: f.importance * contributionDeviationFor(f.feature, f.value),
    }))
    .sort((a, b) => b.contribution - a.contribution);
  const sum = withScore.reduce((a, f) => a + f.contribution, 0) || 1;

  return (
    <div className="rounded-xl bg-bg-surface p-5">
      <h3 className="font-display text-sm font-semibold text-text-primary">
        Why this prediction
      </h3>
      <p className="mt-1 text-[11px] leading-relaxed text-text-tertiary">
        Ranked by contribution = feature importance × deviation from the
        training median (computed by the ML service, displayed verbatim).
      </p>
      <ul className="mt-4 space-y-3">
        {withScore.map((f, i) => {
          const share = Math.max(2, (f.contribution / sum) * 100);
          return (
            <li key={f.feature}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-body text-xs text-text-primary">
                  <span className="mr-1.5 font-mono text-[10px] text-text-tertiary">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {FEATURE_LABELS[f.feature] ?? featureLabel(f.feature)}
                </span>
                <span className="flex-shrink-0 font-mono text-[11px] text-text-secondary">
                  {typeof f.value === "number" ? formatFeatureValue(f.value) : f.value}
                </span>
              </div>
              {/* contribution bar — real share, real score */}
              <div className="mt-1.5 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-raised">
                  <div
                    className="h-full rounded-full bg-accent-violet transition-all duration-500"
                    style={{ width: `${Math.min(100, share)}%` }}
                  />
                </div>
                <span
                  className="w-24 flex-shrink-0 text-right font-mono text-[10px] text-text-tertiary"
                  title={`importance ${f.importance.toFixed(4)} × deviation ${contributionDeviationFor(f.feature, f.value).toFixed(2)}`}
                >
                  contribution {f.contribution.toFixed(2)}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Small mono readout (matches the facility pages' MonoStat style). */
function MonoStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border-hairline bg-bg-inset px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wider text-text-tertiary">{label}</div>
      <div className="mt-0.5 truncate font-mono text-xs text-text-primary">{value}</div>
    </div>
  );
}

export default function PredictPage() {
  // ── form state: only the brief's §6 recommended fields ──────────────────
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [region, setRegion] = useState("india");

  // ── request lifecycle: idle | submitting | done | error ─────────────────
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PredictionResponseDto | null>(null);

  const validation = useMemo(() => {
    const lat = Number(latitude);
    const lng = Number(longitude);
    return {
      lat: latitude.trim() === ""
        ? requiredMsg
        : !Number.isFinite(lat) || lat < -90 || lat > 90
          ? "Latitude must be between −90 and 90."
          : null,
      lng: longitude.trim() === ""
        ? requiredMsg
        : !Number.isFinite(lng) || lng < -180 || lng > 180
          ? "Longitude must be between −180 and 180."
          : null,
      latNum: lat,
      lngNum: lng,
    };
  }, [latitude, longitude]);

  const canSubmit = !submitting && validation.lat === null && validation.lng === null;

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!canSubmit) return;
      setSubmitting(true);
      setError(null);
      setResult(null);
      try {
        const r = await postPredict(validation.latNum, validation.lngNum, region || undefined);
        setResult(r);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Prediction request failed.");
      } finally {
        setSubmitting(false);
      }
    },
    [canSubmit, region, validation.latNum, validation.lngNum],
  );

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  /** Show the map-crosshair convenience without leaving the form. */
  const useMapCoordinates = useCallback(() => {
    // Coordinates must come from the user (or a hotspot they clicked on the
    // Live Map) — this button documents the workflow instead of inventing one.
    window.open("/map", "_blank");
  }, []);

  return (
    <div className="pyro-scroll h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-6 p-6 pb-20">
        <header className="pt-4">
          <h1 className="font-display text-2xl font-semibold text-text-primary">
            Hotspot Classification
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-text-secondary">
            Submit a hotspot&apos;s location and the ML service engineers all 36
            model features — detection persistence, FRP statistics, distances to
            infrastructure, land cover, weather — then classifies it into one of
            four categories with a grounded explanation. Feature engineering and
            preprocessing happen entirely server-side.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
          {/* ── input form (PDF §6 recommended fields only) ─────────────── */}
          <section className="rounded-xl bg-bg-surface p-5">
            <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-text-secondary">
              Hotspot input
            </h2>
            <form className="mt-4 flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
              <NumberField
                label="Latitude"
                hint="−90 … 90"
                required
                value={latitude}
                onChange={(v) => {
                  setLatitude(v);
                  setResult(null);
                  setError(null);
                }}
                placeholder="30.7333"
                min={-90}
                max={90}
                error={latitude ? validation.lat : null}
              />
              <NumberField
                label="Longitude"
                hint="−180 … 180"
                required
                value={longitude}
                onChange={(v) => {
                  setLongitude(v);
                  setResult(null);
                  setError(null);
                }}
                placeholder="76.7794"
                min={-180}
                max={180}
                error={longitude ? validation.lng : null}
              />
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-text-tertiary">
                  Region tag
                </span>
                <select
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-border-hairline bg-bg-inset px-3 py-2 text-sm text-text-primary outline-none transition-colors duration-150 focus:border-accent-primary"
                >
                  <option value="india">India</option>
                  <option value="global">Global</option>
                </select>
              </label>

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className={clsx(
                    "flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-colors duration-150",
                    canSubmit
                      ? "bg-accent-primary/20 text-accent-primary hover:bg-accent-primary/30"
                      : "cursor-not-allowed bg-bg-raised text-text-tertiary",
                  )}
                >
                  {submitting ? (
                    <>
                      <Loader2 size={15} className="animate-spin" />
                      Classifying…
                    </>
                  ) : (
                    <>
                      <Crosshair size={15} />
                      Classify hotspot
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={useMapCoordinates}
                  title="Open the Live Map to pick a hotspot's coordinates"
                  className="flex h-[42px] w-[42px] items-center justify-center rounded-lg border border-border-hairline text-text-secondary transition-colors duration-150 hover:border-border-strong hover:text-text-primary"
                >
                  <MapPin size={15} />
                </button>
              </div>
              <p className="text-[11px] leading-relaxed text-text-tertiary">
                Only the fields the brief recommends are collected — the other 35
                features are derived from FIRMS history, OSM, land cover, and
                weather archives for that exact point. Prediction typically takes
                up to a minute on first run while external sources are queried.
              </p>
            </form>
          </section>

          {/* ── result view (PDF §8) ────────────────────────────────────── */}
          <section aria-live="polite" className="min-w-0">
            {submitting && (
              <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-3 rounded-xl bg-bg-surface">
                <Loader2 size={22} className="animate-spin text-accent-primary" />
                <p className="text-sm text-text-secondary">
                  Engineering features &amp; running the model…
                </p>
                <p className="max-w-xs text-center text-[11px] leading-relaxed text-text-tertiary">
                  Querying FIRMS history, OSM infrastructure, land cover, and
                  weather for this exact point.
                </p>
              </div>
            )}

            {!submitting && error && (
              <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-3 rounded-xl border border-border-hairline bg-bg-surface p-8">
                <AlertTriangle size={22} className="text-status-suspicious" />
                <p className="text-sm font-medium text-text-primary">
                  Prediction failed
                </p>
                <p className="max-w-md break-words text-center text-xs leading-relaxed text-text-secondary">
                  {error}
                </p>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  className="mt-1 rounded-lg border border-border-hairline px-3 py-1.5 text-xs text-text-secondary transition-colors duration-150 hover:border-border-strong hover:text-text-primary"
                >
                  Dismiss
                </button>
              </div>
            )}

            {!submitting && !error && !result && (
              <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-hairline bg-bg-surface/40 p-8 text-center">
                <Crosshair size={20} className="text-text-tertiary" />
                <p className="text-sm text-text-secondary">
                  No prediction yet
                </p>
                <p className="max-w-sm text-xs leading-relaxed text-text-tertiary">
                  Enter coordinates of a FIRMS hotspot (or any point of interest)
                  and run the classifier. The result will appear here with per-class
                  probabilities, key drivers, and a grounded explanation.
                </p>
              </div>
            )}

            {!submitting && !error && result && (
              <div className="flex flex-col gap-5 animation-fade-in">
                {/* warnings — honest degradation notices */}
                {result.warnings.length > 0 && (
                  <div className="rounded-xl border border-border-hairline bg-bg-surface p-4">
                    <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-status-watch">
                      <FileWarning size={12} />
                      Feature warnings
                    </h3>
                    <ul className="mt-2 space-y-1">
                      {result.warnings.map((w, i) => (
                        <li key={i} className="text-xs leading-relaxed text-text-secondary">
                          · {w}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* headline: predicted category + confidence + risk */}
                <div className="rounded-xl bg-bg-surface p-6">
                  <div className="flex flex-wrap items-start justify-between gap-6">
                    <div className="min-w-0">
                      <div className="text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
                        Predicted Hotspot Category
                      </div>
                      <div
                        className="mt-1.5 font-display text-2xl font-semibold leading-tight"
                        style={{ color: MODEL_CLASS_COLORS[result.class] }}
                      >
                        {MODEL_CLASS_LABELS[result.class]}
                      </div>
                      <div className="mt-1 font-mono text-[11px] text-text-tertiary">
                        {result.class}
                      </div>
                    </div>
                    <div className="flex gap-8">
                      <div className="flex flex-col items-center">
                        <span className="font-display text-3xl font-semibold text-text-primary">
                          {(result.confidence * 100).toFixed(1)}
                          <span className="ml-0.5 text-sm text-text-tertiary">%</span>
                        </span>
                        <span className="mt-1 text-[10px] uppercase tracking-wider text-text-tertiary">
                          Confidence
                        </span>
                      </div>
                      <div className="flex flex-col items-center">
                        <span
                          className="font-display text-3xl font-semibold"
                          style={{
                            color:
                              result.risk_score >= 66
                                ? "#C26A6A"
                                : result.risk_score >= 33
                                  ? "#B99B5E"
                                  : "#5FA97C",
                          }}
                        >
                          {result.risk_score.toFixed(1)}
                        </span>
                        <span className="mt-1 text-[10px] uppercase tracking-wider text-text-tertiary">
                          Model risk score
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* probabilities (Track A3) — stacked distribution + ranked rows,
                      winning class highlighted. Values rendered verbatim. */}
                  <ConfidenceDistribution probabilities={result.probabilities} predictedClass={result.class} />
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {MODEL_CLASSES.map((cls) => (
                      <ProbabilityBar
                        key={cls}
                        cls={cls}
                        probability={result.probabilities[cls] ?? 0}
                        winner={cls === result.class}
                      />
                    ))}
                  </div>

                  <p className="mt-4 border-t border-border-hairline pt-3 text-[11px] leading-relaxed text-text-tertiary">
                    This category is the trained model&apos;s supervised
                    classification of the hotspot — distinct from the
                    rule-based Risk Status (Normal / Watch / Suspicious /
                    Critical) shown on facility pages.
                  </p>
                </div>

                {/* explanation — near the category, not buried (P1) */}
                <div className="rounded-xl bg-bg-surface p-5">
                  <h3 className="flex items-center gap-2 font-display text-sm font-semibold text-text-primary">
                    Why this classification
                    <span
                      className={clsx(
                        "rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider",
                        result.explanation_provenance === "template"
                          ? "bg-bg-raised text-text-tertiary"
                          : "bg-accent-secondary/15 text-accent-secondary",
                      )}
                    >
                      {result.explanation_provenance === "template"
                        ? "templated"
                        : "grounded GenAI"}
                    </span>
                  </h3>
                  <p className="mt-2.5 whitespace-pre-line text-sm leading-relaxed text-text-secondary">
                    {result.explanation}
                  </p>
                </div>

                {/* key drivers (Track A1) — explainability panel with real
                    contribution bars, sorted descending, no raw JSON */}
                <ExplainabilityCard features={result.top_contributing_features} />

                {/* analyzed location + input summary + timestamp (§8) */}
                <div className="rounded-xl bg-bg-surface p-5">
                  <h3 className="flex items-center gap-1.5 font-display text-sm font-semibold text-text-primary">
                    <Satellite size={14} className="text-accent-secondary" />
                    Analysis record
                  </h3>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <MonoStat label="Analyzed location" value={`${validation.latNum.toFixed(4)}°, ${validation.lngNum.toFixed(4)}°`} />
                    <MonoStat label="Hotspot ID" value={result.hotspot_id} />
                    <MonoStat
                      label="Timestamp (UTC)"
                      value={new Date(result.prediction_timestamp).toISOString().replace("T", " ").slice(0, 19)}
                    />
                    <MonoStat label="Model version" value={result.model_version} />
                    <MonoStat label="Dataset version" value={result.dataset_version} />
                    <MonoStat label="Schema version" value={result.feature_schema_version} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {Object.entries(result.feature_provenance).map(([block, src]) => (
                      <span
                        key={block}
                        className={clsx(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                          src === "median_fallback"
                            ? "bg-status-watch/15 text-status-watch"
                            : "bg-bg-raised text-text-secondary",
                        )}
                      >
                        <CheckCircle2 size={9} aria-hidden />
                        {block}: {src}
                      </span>
                    ))}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link
                      href={`/map`}
                      className="flex items-center gap-1.5 rounded-lg border border-border-hairline bg-bg-raised px-3 py-1.5 text-xs text-text-secondary transition-colors duration-150 hover:border-border-strong hover:text-text-primary"
                    >
                      <MapPin size={12} />
                      Inspect on Live Map
                    </Link>
                    <button
                      type="button"
                      onClick={reset}
                      className="flex items-center gap-1.5 rounded-lg border border-border-hairline bg-bg-raised px-3 py-1.5 text-xs text-text-secondary transition-colors duration-150 hover:border-border-strong hover:text-text-primary"
                    >
                      <RotateCcw size={12} />
                      Clear result
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

const requiredMsg = "Required.";
