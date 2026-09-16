"use client";

import React from "react";
import { Play, Pause, SkipBack, SkipForward, X } from "lucide-react";
import clsx from "clsx";
import type { ReplayState } from "@/lib/replay";

/**
 * Replay transport (Track B) — play / pause / step / exit + real progress
 * ("4 / 14") and the current step's acquisition date. Disabled (hidden)
 * unless replay is scoped to a facility: B1 requires facility selection.
 */
export default function ReplayControls({
  replay,
  className,
}: {
  replay: ReplayState;
  className?: string;
}) {
  if (!replay.active) return null;
  const atStart = replay.index < 0;
  const finished = replay.index >= replay.sequence.length - 1 && !replay.playing;

  return (
    <div
      className={clsx(
        "flex items-center gap-2.5 rounded-lg border border-accent-primary/40 bg-bg-raised/95 px-3 py-2 shadow-lg shadow-black/40 backdrop-blur animation-fade-in",
        className,
      )}
    >
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
        className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-primary/15 text-accent-primary transition-colors duration-150 hover:bg-accent-primary/25"
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
        {replay.label}
      </span>
      <span className="font-mono text-[11px] text-text-secondary">
        {replay.current ? replay.current.acqDate : "start"}
      </span>

      <button
        type="button"
        aria-label="Exit replay"
        onClick={replay.exit}
        className="ml-1 flex h-6 w-6 items-center justify-center rounded text-text-tertiary transition-colors duration-150 hover:text-text-primary"
      >
        <X size={13} />
      </button>
    </div>
  );
}
