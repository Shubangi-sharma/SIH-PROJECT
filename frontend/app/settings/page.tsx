"use client";

import React, { useState } from "react";
import clsx from "clsx";
import { STATUS_META, STATUS_ORDER } from "@/lib/types";
import { StatusGlyph } from "@/lib/status";
import { FRP_BANDS } from "@/lib/firms";

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
