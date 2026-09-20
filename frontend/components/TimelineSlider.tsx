"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Calendar, Play, Pause, SkipBack, SkipForward } from "lucide-react";
import { FirmsHotspot } from "@/lib/firms";
import clsx from "clsx";

/**
 * TimelineSlider — scrubs through historical detections by acquisition date.
 * Updates a filter callback so the map only shows hotspots active at the
 * selected time step. Uses the existing pyro-range CSS styling.
 *
 * Render-safety rule: state updaters here are PURE — the parent's
 * `onFilterDate` is never called inside a setState updater (React treats
 * updater bodies as render-phase code, so a parent setState from there
 * triggers "Cannot update a component while rendering a different
 * component"). The parent filter is synced from the derived `currentDate`
 * in a single effect instead.
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

  /* Single sync point: the parent's date filter always mirrors the slider
     index. Runs on mount with null (a no-op setState for the parent — the
     value is already null) and on every index change. */
  useEffect(() => {
    onFilterDate(currentDate);
  }, [currentDate, onFilterDate]);

  /* Auto-play: advance one step every 800 ms. The updater only computes the
     next index; stopping is handled by the effect below when the playhead
     wraps past the last date (index returns to null). */
  useEffect(() => {
    if (!playing || index === null) return;
    const t = setInterval(() => {
      setIndex((prev) => {
        const next = (prev ?? -1) + 1;
        return next >= dates.length ? null : next;
      });
    }, 800);
    return () => clearInterval(t);
  }, [playing, index, dates.length]);

  /* Playhead wrapped past the end while playing → stop. */
  useEffect(() => {
    if (playing && index === null) setPlaying(false);
  }, [playing, index]);

  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = Number(e.target.value);
      // The extra final tick position is "all dates" (no filter).
      setIndex(val >= dates.length ? null : val);
    },
    [dates.length],
  );

  const stepTo = useCallback(
    (newIndex: number | null) => {
      if (newIndex === null) {
        setIndex(null);
        return;
      }
      setIndex(Math.max(0, Math.min(newIndex, dates.length - 1)));
    },
    [dates.length],
  );

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
