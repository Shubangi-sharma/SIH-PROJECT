"use client";

import React, { useCallback, useMemo, useState } from "react";
import { Calendar, Play, Pause, SkipBack, SkipForward } from "lucide-react";
import { FirmsHotspot } from "@/lib/firms";
import clsx from "clsx";

/**
 * TimelineSlider — scrubs through historical detections by acquisition date.
 * Updates a filter callback so the map only shows hotspots active at the
 * selected time step. Uses the existing pyro-range CSS styling.
 */
export default function TimelineSlider({
  hotspots,
  onFilterDate,
  className,
}: {
  hotspots: FirmsHotspot[];
  /** Called with the selected date string (YYYY-MM-DD) or null for "all". */
  onFilterDate: (date: string | null) => void;
  className?: string;
}) {
  const [playing, setPlaying] = useState(false);
  const [index, setIndex] = useState<number | null>(null);

  /** Sorted unique acquisition dates from the hotspot data. */
  const dates = useMemo(() => {
    const set = new Set<string>();
    for (const h of hotspots) {
      if (h.acqDate) set.add(h.acqDate);
    }
    return [...set].sort();
  }, [hotspots]);

  const currentDate = index != null ? dates[index] ?? null : null;

  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = Number(e.target.value);
      if (val >= dates.length) {
        setIndex(null);
        onFilterDate(null);
      } else {
        setIndex(val);
        onFilterDate(dates[val] ?? null);
      }
    },
    [dates, onFilterDate],
  );

  const stepTo = useCallback(
    (newIndex: number | null) => {
      if (newIndex === null || newIndex >= dates.length) {
        setIndex(null);
        onFilterDate(null);
      } else {
        const clamped = Math.max(0, Math.min(newIndex, dates.length - 1));
        setIndex(clamped);
        onFilterDate(dates[clamped] ?? null);
      }
    },
    [dates, onFilterDate],
  );

  // Auto-play: step forward every 800ms
  React.useEffect(() => {
    if (!playing || dates.length === 0) return;
    const t = setInterval(() => {
      setIndex((prev) => {
        const next = (prev ?? -1) + 1;
        if (next >= dates.length) {
          setPlaying(false);
          onFilterDate(null);
          return null;
        }
        onFilterDate(dates[next] ?? null);
        return next;
      });
    }, 800);
    return () => clearInterval(t);
  }, [playing, dates, onFilterDate]);

  if (dates.length < 2) return null;

  return (
    <div
      className={clsx(
        "flex items-center gap-3 rounded-lg border border-border-hairline bg-bg-raised/95 px-3 py-2 shadow-lg shadow-black/40 backdrop-blur",
        className,
      )}
    >
      <Calendar size={13} className="flex-shrink-0 text-text-tertiary" />

      {/* transport controls */}
      <button
        type="button"
        aria-label="Skip to start"
        onClick={() => stepTo(0)}
        className="flex h-6 w-6 items-center justify-center rounded text-text-tertiary transition-colors hover:text-text-primary"
      >
        <SkipBack size={12} />
      </button>
      <button
        type="button"
        aria-label={playing ? "Pause" : "Play"}
        onClick={() => {
          if (!playing && index === null) setIndex(0);
          setPlaying((p) => !p);
        }}
        className="flex h-6 w-6 items-center justify-center rounded text-accent-primary transition-colors hover:text-accent-secondary"
      >
        {playing ? <Pause size={12} /> : <Play size={12} />}
      </button>
      <button
        type="button"
        aria-label="Skip to end"
        onClick={() => stepTo(null)}
        className="flex h-6 w-6 items-center justify-center rounded text-text-tertiary transition-colors hover:text-text-primary"
      >
        <SkipForward size={12} />
      </button>

      {/* range slider */}
      <input
        type="range"
        min={0}
        max={dates.length}
        step={1}
        value={index ?? dates.length}
        onChange={handleSliderChange}
        className="pyro-range h-1 flex-1"
        style={{
          background: `linear-gradient(to right, #6E93BE ${((index ?? dates.length) / dates.length) * 100}%, #1A2028 0%)`,
        }}
        aria-label="Timeline date"
      />

      {/* current date label */}
      <span className="min-w-[72px] text-right font-mono text-[11px] text-text-secondary">
        {currentDate ?? "All dates"}
      </span>
    </div>
  );
}
