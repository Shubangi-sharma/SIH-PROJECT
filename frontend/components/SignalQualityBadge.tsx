"use client";

import React from "react";
import { Waves } from "lucide-react";
import clsx from "clsx";

/**
 * Signal Quality (backend Track C2) — the VIIRS confidence-band split of the
 * facility's live window, e.g. "2 of 3 high confidence".
 *
 * Every number comes from the backend's classification (`liveConfidenceSplit`);
 * `low` counts gated-out detections too, so the operator sees the real sensor
 * quality mix — never a filtered version of it. No server field → the badge
 * renders nothing rather than inventing a value.
 */

const BAND_COLORS = { high: "#5FA97C", nominal: "#B99B5E", low: "#5D6570" } as const;

export default function SignalQualityBadge({
  split,
  className,
}: {
  split?: { high: number; nominal: number; low: number } | null;
  className?: string;
}) {
  if (!split) return null;
  const total = split.high + split.nominal + split.low;
  if (total === 0) return null; // no live detections → nothing to assess

  const nominalish = split.high + split.nominal; // usable in scoring (h + n/m/"")
  const best = Math.max(split.high, split.nominal, split.low);

  return (
    <div
      className={clsx(
        "flex items-center gap-2.5 rounded-lg border border-border-hairline bg-bg-inset px-3 py-2",
        className,
      )}
      title="VIIRS per-detection confidence bands in the last 10 days. Low-band detections are shown but excluded from scoring by the quality gate."
    >
      <Waves size={13} className="flex-shrink-0 text-text-tertiary" aria-hidden />
      <div className="min-w-0">
        <div className="text-[9px] font-semibold uppercase tracking-widest text-text-tertiary">
          Signal quality
        </div>
        <div className="mt-0.5 font-mono text-xs text-text-primary">
          {best === split.high && split.high > 0
            ? `${split.high} of ${total} high confidence`
            : `${nominalish} of ${total} usable confidence`}
        </div>
      </div>
      {/* band split bar — real proportions, real colours */}
      <div className="ml-auto flex h-1.5 w-14 overflow-hidden rounded-full bg-bg-raised">
        {(["high", "nominal", "low"] as const).map((band) =>
          split[band] > 0 ? (
            <span
              key={band}
              className="h-full"
              style={{ width: `${(split[band] / total) * 100}%`, backgroundColor: BAND_COLORS[band] }}
            />
          ) : null,
        )}
      </div>
    </div>
  );
}
