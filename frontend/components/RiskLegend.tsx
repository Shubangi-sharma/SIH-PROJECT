"use client";

import { RISK_LEVEL_COLORS } from "@/lib/riskApi";

/**
 * RiskLegend — explains the three GRU horizon signals honestly.
 *
 * Wording is load-bearing (LIMITATIONS.md §3/§4): levels are DECISION
 * THRESHOLDS (score ≥ threshold → HIGH signal), not probabilities and not
 * "% chance of fire". The 7-day horizon carries its own weak-signal caveat
 * from the model card, shown right in the legend so demo commentary and UI
 * can never drift apart.
 */

const HORIZONS: { key: "1day" | "3day" | "7day"; label: string; threshold: number; caveat?: string }[] = [
  { key: "1day", label: "1-day", threshold: 0.65 },
  { key: "3day", label: "3-day", threshold: 0.40 },
  {
    key: "7day",
    label: "7-day",
    threshold: 0.35,
    caveat: "long-range signal only",
  },
];

export default function RiskLegend({ className }: { className?: string }) {
  return (
    <section
      aria-label="Risk legend"
      className={
        className ??
        "rounded-xl border border-border-hairline bg-bg-surface/95 p-3.5 shadow-lg shadow-black/40 backdrop-blur"
      }
    >
      <h3 className="font-display text-xs font-semibold uppercase tracking-wider text-text-secondary">
        Risk signals
      </h3>

      {/* Overall rule — one line, exactly the ≥2/1/0 HIGH logic */}
      <p className="mt-1.5 text-[11px] leading-snug text-text-tertiary">
        Overall: 2+ HIGH signals → <span className="text-text-primary">HIGH</span> · 1 →{" "}
        <span className="text-text-primary">MODERATE</span> · 0 →{" "}
        <span className="text-text-primary">LOW</span>
      </p>

      <ul className="mt-2.5 space-y-1.5">
        {HORIZONS.map((h) => (
          <li key={h.key} className="flex items-center gap-2 text-[11px]">
            <span
              className="inline-block h-2 w-2 flex-shrink-0 rounded-full"
              style={{ backgroundColor: RISK_LEVEL_COLORS[h.key === "1day" ? "HIGH" : "MODERATE"] }}
            />
            <span className="font-mono text-text-primary">{h.label}</span>
            <span className="text-text-secondary">
              HIGH when score ≥ {h.threshold.toFixed(2)}
            </span>
            {h.caveat && (
              <span className="ml-auto rounded-full bg-bg-raised px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-status-watch">
                {h.caveat}
              </span>
            )}
          </li>
        ))}
      </ul>

      <p className="mt-2.5 border-t border-border-hairline pt-2 text-[10px] leading-snug text-text-tertiary">
        Signals come from fixed decision thresholds — they are{" "}
        <span className="text-text-secondary">not probabilities</span> and not a
        &quot;% chance of fire&quot;.
      </p>
    </section>
  );
}
