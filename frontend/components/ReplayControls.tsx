"use client";

import React from "react";
import { Play, Pause, SkipBack, SkipForward, X } from "lucide-react";
import clsx from "clsx";
import type { ReplayState } from "@/lib/replay";

/**
 * Replay transport (Track B) — play / pause / step / exit + real progress
 * ("4 / 14") and the current step's acquisition date. Disabled (hidden)
 * unless replay is scoped to a facility: B1 requires facility selection.
 *
 * Visual pass: glass card matching the map chrome, with a thin progress bar
 * that fills by real step index. Behavior unchanged from lib/replay.ts.
 */
export default function ReplayControls({
  replay,
  count = 0,
  className,
}: {
  replay: ReplayState;
  /** Detections currently on the map for the replayed step (already filtered). */
  count?: number;
  className?: string;
}) {
  if (!replay.active) return null;
  const atStart = replay.index < 0;
  const finished = replay.index >= replay.sequence.length - 1 && !replay.playing;
  const progress =
    replay.sequence.length > 0 && replay.index >= 0
      ? ((replay.index + 1) / replay.sequence.length) * 100
      : 0;

  return (
    <div
      className={clsx(
        "map-glass overflow-hidden rounded-xl animation-fade-in",
        className,
      )}
    >
      <div className="flex items-center gap-2.5 px-3 py-2">
        <span
          className={clsx(
            "inline-block h-1.5 w-1.5 rounded-full",
            replay.playing ? "animate-pulse bg-accent-secondary" : "bg-text-tertiary",
          )}
          aria-hidden
        />
        <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-accent-primary">
          Replay
        </span>

        <button
          type="button"
          aria-label="Previous detection"
          onClick={() => replay.stepTo(replay.index - 1)}
          disabled={atStart}
          className="flex h-6 w-6 items-center justify-center rounded text-text-tertiary transition-colors duration-150 hover:text-text-primary disabled:opacity-30"
        >
          <SkipBack size={12} />
        </button>
        <button
          type="button"
          aria-label={replay.playing ? "Pause replay" : "Play replay"}
          onClick={replay.toggle}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-primary/20 text-accent-primary ring-1 ring-accent-primary/40 transition-colors duration-150 hover:bg-accent-primary/30"
        >
          {replay.playing ? <Pause size={13} /> : <Play size={13} />}
        </button>
        <button
          type="button"
          aria-label="Next detection"
          onClick={() => replay.stepTo(replay.index + 1)}
          disabled={finished}
          className="flex h-6 w-6 items-center justify-center rounded text-text-tertiary transition-colors duration-150 hover:text-text-primary disabled:opacity-30"
        >
          <SkipForward size={12} />
        </button>

        <span className="font-mono text-[11px] text-text-primary">
          {replay.label ?? `0 / ${replay.sequence.length}`}
        </span>
        {/* live count for the current step — same number the map shows */}
        <div className="ml-1 text-right">
          <div className="font-mono text-[12px] font-semibold leading-tight text-text-primary tabular-nums">
            {count.toLocaleString("en-US")}
            <span className="ml-1 text-[9px] font-normal text-text-tertiary">det</span>
          </div>
          <div className="font-mono text-[10px] leading-tight text-text-tertiary">
            {replay.current ? replay.current.acqDate : "start"}
          </div>
        </div>

        <button
          type="button"
          aria-label="Exit replay"
          onClick={replay.exit}
          className="ml-1 flex h-6 w-6 items-center justify-center rounded text-text-tertiary transition-colors duration-150 hover:text-text-primary"
        >
          <X size={13} />
        </button>
      </div>

      {/* real progress — fills with the step index, resets to live at exit */}
      <div className="h-[2px] w-full bg-white/[0.06]">
        <div
          className="h-full transition-[width] duration-300 ease-out"
          style={{
            width: `${progress}%`,
            background: "linear-gradient(90deg, #5B9BD5 0%, #4FB3B3 100%)",
          }}
        />
      </div>
    </div>
  );
}
