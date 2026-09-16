"use client";

import React from "react";
import { ListVideo } from "lucide-react";
import { DetectionEvent, statusColorHex } from "@/lib/types";
import { StatusGlyph } from "@/lib/status";
import clsx from "clsx";

/**
 * Incident Story Engine (Track A2) — a vertical timeline of REAL detections
 * (backend narrative.timeline, newest-first). Each step: acquisition
 * timestamp + event text, colour-paired with its severity glyph (§9).
 *
 * Replay integration (Track B): `activeIndex` highlights the step currently
 * shown by the replay controller — `0` is the newest event (list order),
 * while replay time counts UP from the oldest, so the mapping is inverted.
 * `null` = not replaying; no highlight.
 */
export default function IncidentTimeline({
  events,
  activeIndex = null,
  className,
}: {
  events: DetectionEvent[];
  /** Index into `events` (0 = newest) of the replay-active step, or null. */
  activeIndex?: number | null;
  className?: string;
}) {
  return (
    <section className={clsx("rounded-xl bg-bg-surface p-4", className)}>
      <h3 className="flex items-center gap-1.5 font-display text-sm font-semibold text-text-primary">
        <ListVideo size={14} className="text-text-tertiary" aria-hidden />
        Incident Timeline
      </h3>
      {events.length === 0 ? (
        <p className="mt-3 rounded-lg border border-border-hairline bg-bg-raised px-3 py-2 text-xs leading-relaxed text-text-secondary">
          No detections in the stored history for this facility yet — the
          timeline fills in as FIRMS observations arrive.
        </p>
      ) : (
        <ul className="mt-4 space-y-0">
          {events.map((ev, i) => {
            const hex = statusColorHex(ev.severity);
            const active = activeIndex === i;
            return (
              <li
                key={`${ev.time}-${i}`}
                className={clsx(
                  "flex gap-3 rounded-lg transition-colors duration-200",
                  active && "bg-accent-primary/10 ring-1 ring-inset ring-accent-primary/40",
                )}
                aria-current={active ? "step" : undefined}
              >
                {/* mono timestamp, left of the line */}
                <span
                  className={clsx(
                    "w-[76px] flex-shrink-0 pt-0.5 text-right font-mono text-xs",
                    active ? "text-accent-primary" : "text-text-tertiary",
                  )}
                >
                  {ev.time}
                </span>
                {/* connecting line + node */}
                <div className="relative w-[2px] flex-shrink-0 rounded bg-border-strong">
                  <span
                    className={clsx(
                      "absolute left-1/2 top-1.5 h-2 w-2 -translate-x-1/2 rounded-full ring-2 ring-bg-surface transition-all duration-200",
                      active && "h-3 w-3 top-1",
                    )}
                    style={{ backgroundColor: hex }}
                  />
                </div>
                {/* event text, colour paired with shape glyph per §9 */}
                <div className="flex items-start gap-1.5 py-1.5 pr-2 last:pb-0">
                  <StatusGlyph status={ev.severity} size={8} className="mt-1.5 flex-shrink-0" />
                  <span
                    className={clsx(
                      "font-body text-sm leading-snug",
                      active ? "text-text-primary" : "text-text-primary/85",
                    )}
                  >
                    {ev.text}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
