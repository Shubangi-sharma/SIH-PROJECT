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
 * The bar carries the live detection count for the CURRENT step (the same
 * number the map's bubbles/cluster bubbles sum to), so the timeline itself —
 * not a separate floating chip — is the single source of "how many detections
 * right now". This removes the old bottom-left FIRMS chip that overlapped
 * the timeline and could disagree with it.
 *
 * A per-date histogram (bar heights = detections that date) sits behind the
 * range so the operator can see WHERE activity concentrated before scrubbing.
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
  count = 0,
  className,
}: {
  hotspots: FirmsHotspot[];
  /** Called with the selected date string (YYYY-MM-DD) or null for "all". */
  onFilterDate: (date: string | null) => void;
  /** Detections currently on the map for the selected step (already filtered). */
  count?: number;
  className?: string;
}) {
  const [playing, setPlaying] = useState(false);
  const [index, setIndex] = useState<number | null>(null);

  /** Sorted unique acquisition dates + per-date detection counts. */
  const { dates, counts, peak } = useMemo(() => {
    const dateSet = new Set<string>();
    const perDate = new Map<string, number>();
    for (const h of hotspots) {
      if (!h.acqDate) continue;
      dateSet.add(h.acqDate);
      perDate.set(h.acqDate, (perDate.get(h.acqDate) ?? 0) + 1);
    }
    const d = [...dateSet].sort();
    let max = 1;
    for (const v of perDate.values()) if (v > max) max = v;
    return { dates: d, counts: perDate, peak: max };
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
        "rounded-xl px-4 py-2.5",
        className,
      )}
    >
      <div className="flex items-center gap-3">
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

        {/* slider + histogram — the histogram bars sit behind the track and
            are purely indicative (height = share of that date's detections) */}
        <div className="relative flex-1">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-[5px] flex h-6 items-end justify-between opacity-70">
            {dates.map((d) => (
              <span
                key={d}
                className="w-[3px] rounded-sm"
                style={{
                  height: `${Math.max(8, ((counts.get(d) ?? 0) / peak) * 100)}%`,
                  background:
                    currentDate && d === currentDate ? "#5B9BD5" : "rgba(91,155,213,0.28)",
                }}
              />
            ))}
          </div>
          <input
            type="range"
            min={0}
            max={dates.length}
            step={1}
            value={index ?? dates.length}
            onChange={handleSliderChange}
            className="pyro-range relative h-1 w-full"
            style={{
              background: `linear-gradient(to right, #5B9BD5 ${((index ?? dates.length) / dates.length) * 100}%, #1A2028 0%)`,
            }}
            aria-label="Timeline date"
          />
        </div>

        {/* live count + date — the map and this bar always agree because the
            parent passes the same filtered array it renders */}
        <div className="min-w-[104px] text-right">
          <div className="font-mono text-[13px] font-semibold leading-tight text-text-primary tabular-nums">
            {count.toLocaleString("en-US")}
            <span className="ml-1 text-[9px] font-normal text-text-tertiary">det</span>
          </div>
          <div className="font-mono text-[10px] leading-tight text-text-tertiary">
            {currentDate ?? "All dates (10d)"}
          </div>
        </div>
      </div>
    </div>
  );
}
