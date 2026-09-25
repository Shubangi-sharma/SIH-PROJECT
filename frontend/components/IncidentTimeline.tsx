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
 *
 * Readability makeover: every event is a self-contained card on a severity-
 * tinted left rail, so scanning is by shape of the list, not by tracking a
 * thin connector line. The newest event is badged "latest".
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
    <section className={clsx("dash-card rounded-xl p-4", className)}>
      <div className="flex items-center gap-1.5">
        <ListVideo size={14} className="text-text-tertiary" aria-hidden />
        <h3 className="font-display text-sm font-semibold text-text-primary">
          Incident Timeline
        </h3>
        {events.length > 0 && (
          <span className="ml-auto rounded-full bg-bg-raised px-2 py-0.5 font-mono text-[10px] text-text-secondary">
            {events.length} {events.length === 1 ? "event" : "events"}
          </span>
        )}
      </div>

      {events.length === 0 ? (
        <p className="mt-3 rounded-lg border border-border-hairline bg-bg-raised px-3 py-2 text-xs leading-relaxed text-text-secondary">
          No detections in the stored history for this facility yet - the
          timeline fills in as FIRMS observations arrive.
        </p>
      ) : (
        <ul className="mt-3.5 space-y-1.5">
          {events.map((ev, i) => {
            const hex = statusColorHex(ev.severity);
            const active = activeIndex === i;
            return (
              <li
                key={`${ev.time}-${i}`}
                className={clsx(
                  "relative flex flex-col gap-0.5 overflow-hidden rounded-lg border px-3 py-2 transition-all duration-200",
                  active
                    ? "border-accent-primary/50 bg-accent-primary/10"
                    : "border-white/[0.04] bg-white/[0.015] hover:border-white/[0.09] hover:bg-white/[0.03]",
                )}
                aria-current={active ? "step" : undefined}
              >
                {/* severity rail */}
                <span
                  aria-hidden
                  className="absolute left-0 top-0 h-full w-[3px]"
                  style={{ backgroundColor: hex, opacity: active ? 1 : 0.55 }}
                />

                <div className="flex items-center gap-2 pl-1.5">
                  <StatusGlyph status={ev.severity} size={8} className="flex-shrink-0" />
                  {/* mono timestamp - the anchor of each row */}
                  <span
                    className={clsx(
                      "font-mono text-[11px] font-medium",
                      active ? "text-accent-primary" : "text-text-secondary",
                    )}
                  >
                    {ev.time}
                  </span>
                  {i === 0 && (
                    <span className="rounded-full bg-accent-secondary/15 px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-accent-secondary">
                      latest
                    </span>
                  )}
                  {active && (
                    <span className="rounded-full bg-accent-primary/20 px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-accent-primary">
                      replaying
                    </span>
                  )}
                </div>

                {/* event text - own line, full width, comfortably readable */}
                <span
                  className={clsx(
                    "pl-1.5 font-body text-[13px] leading-snug",
                    active ? "text-text-primary" : "text-text-secondary",
                  )}
                >
                  {ev.text}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
