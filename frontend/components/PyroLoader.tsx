"use client";

/**
 * PyroLoader — the app's loading screen.
 *
 * A minimal burning flame: two morphing fire-body layers over a hot core,
 * with a flickering light halo and embers rising off the tip. Pure CSS
 * keyframes — no canvas, no rAF loop — so it stays cheap even when several
 * loaders render at once (drawers, panels, full-page waits).
 *
 * Fires follow no perfect loop — the layered `fire-*` keyframes run on
 * deliberately mismatched durations (2.2s / 1.7s / 0.9s / 0.6s), so the
 * combined shape never visibly repeats.
 */

import React from "react";

export default function PyroLoader({
  label = "Scanning thermal feed",
  sub,
  size = 88,
  compact = false,
}: {
  label?: string;
  sub?: string;
  /** Outer bounding box of the flame in px. */
  size?: number;
  /** Compact variant for inline panels — smaller flame, tighter type. */
  compact?: boolean;
}) {
  const embers = [0, 1, 2];

  return (
    <div
      className="flex flex-col items-center justify-center gap-4 select-none"
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <div
        className="relative flex items-center justify-center"
        style={{ width: size, height: size }}
      >
        {/* flickering light on the surroundings */}
        <div
          className="absolute rounded-full"
          style={{
            width: size * 1.15,
            height: size * 1.15,
            background:
              "radial-gradient(circle, rgba(224,110,60,0.16) 0%, rgba(224,96,96,0.07) 45%, transparent 70%)",
            animation: "flicker 1.9s ease-in-out infinite",
          }}
        />

        {/* outer flame — cool body of the fire */}
        <div
          className="absolute"
          style={{
            left: "50%",
            width: size * 0.52,
            height: size * 0.72,
            background:
              "linear-gradient(to top, rgba(224,96,96,0.9) 0%, rgba(240,140,70,0.85) 55%, rgba(245,176,76,0.55) 100%)",
            borderRadius: "50% 50% 46% 46% / 62% 62% 38% 38%",
            filter: "blur(2.5px)",
            transformOrigin: "50% 100%",
            animation: "fire-sway 2.2s ease-in-out infinite",
          }}
        />

        {/* inner flame — hotter, faster morph */}
        <div
          className="absolute"
          style={{
            left: "50%",
            width: size * 0.3,
            height: size * 0.46,
            background:
              "linear-gradient(to top, rgba(245,176,76,0.9) 0%, rgba(255,214,130,0.85) 100%)",
            borderRadius: "50% 50% 46% 46% / 64% 64% 36% 36%",
            filter: "blur(1.5px)",
            transformOrigin: "50% 100%",
            animation: "fire-inner 1.7s ease-in-out infinite",
          }}
        />

        {/* hot core — the blue-base ember inside the flame */}
        <div
          className="absolute"
          style={{
            width: size * 0.13,
            height: size * 0.13,
            left: "50%",
            bottom: size * 0.13,
            transform: "translateX(-50%)",
            borderRadius: "50% 50% 50% 50% / 58% 58% 42% 42%",
            background:
              "radial-gradient(circle at 50% 65%, rgba(245,225,180,0.95) 0%, rgba(255,235,190,0.5) 60%, transparent 100%)",
            filter: "blur(0.5px)",
            animation: "core-pulse 1.1s ease-in-out infinite",
          }}
        />

        {/* embers rising off the tip */}
        {embers.map((i) => (
          <span
            key={i}
            className="absolute rounded-full"
            style={{
              left: `calc(50% + ${(i - 1) * 10}px)`,
              bottom: size * 0.62,
              width: 3,
              height: 3,
              background: "rgba(240,163,92,0.9)",
              boxShadow: "0 0 6px rgba(240,163,92,0.8)",
              opacity: compact ? 0.55 : 1,
              animation: `ember-rise 2.2s ease-out ${i * 0.7}s infinite`,
            }}
          />
        ))}
      </div>

      <div className="text-center">
        <p
          className={`font-display font-medium text-text-secondary ${
            compact ? "text-xs" : "text-sm"
          }`}
        >
          {label}
        </p>
        {sub && (
          <p className="mt-1 max-w-[280px] text-[11px] leading-relaxed text-text-tertiary">
            {sub}
          </p>
        )}
      </div>
    </div>
  );
}
