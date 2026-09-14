"use client";

import React from "react";
import { DetectionEvent, statusColorHex } from "@/lib/types";
import { StatusGlyph } from "@/lib/status";

export default function IncidentTimeline({
  events,
}: {
  events: DetectionEvent[];
}) {
  return (
    <section className="rounded-xl bg-bg-surface p-4">
      <h3 className="font-display text-sm font-semibold text-text-primary">
        Incident Timeline
      </h3>
      <ul className="mt-4 space-y-0">
        {events.map((ev, i) => {
          const hex = statusColorHex(ev.severity);
          return (
            <li key={i} className="flex gap-3">
              {/* mono timestamp, left of the line */}
              <span className="w-12 flex-shrink-0 pt-0.5 text-right font-mono text-xs text-text-tertiary">
                {ev.time}
              </span>
              {/* connecting line + node */}
              <div className="relative w-[2px] flex-shrink-0 rounded bg-border-strong">
                <span
                  className="absolute left-1/2 top-1.5 h-2 w-2 -translate-x-1/2 rounded-full ring-2 ring-bg-surface"
                  style={{ backgroundColor: hex }}
                />
              </div>
              {/* event text, colour paired with shape glyph per §9 */}
              <div className="flex items-start gap-1.5 pb-5 pt-0.5 last:pb-0">
                <StatusGlyph status={ev.severity} size={8} className="mt-1.5 flex-shrink-0" />
                <span className="font-body text-sm leading-snug text-text-primary">
                  {ev.text}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
