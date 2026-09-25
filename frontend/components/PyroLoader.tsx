"use client";

/**
 * PyroLoader — the app's loading screen.
 *
 * Minimal, thermal-instrument themed: an orbiting scan ring around an ember
 * that pulses, with three rising sparks and an optional status line. Used
 * wherever a data source keeps the user waiting (analytics, drawers, full-
 * page waits). No spinners-on-blank — one calm, branded moment.
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
  /** Outer diameter of the scan ring in px. */
  size?: number;
  /** Compact variant for inline panels — smaller ring, tighter type. */
  compact?: boolean;
}) {
  const sparks = [0, 1, 2];

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
        {/* orbiting scan ring */}
        <div
          className="pyro-loader-ring absolute inset-0 rounded-full"
          style={{ width: size, height: size }}
        />
        {/* soft ember core */}
        <div
          className="absolute rounded-full"
          style={{
            width: size * 0.34,
            height: size * 0.34,
            background:
              "radial-gradient(circle at 50% 42%, rgba(240,163,92,0.95) 0%, rgba(224,96,96,0.75) 45%, rgba(224,96,96,0) 72%)",
            filter: "blur(1px)",
            animation: "glow-pulse 2.4s ease-in-out infinite",
          }}
        />
        {/* rising sparks */}
        {!compact &&
          sparks.map((i) => (
            <span
              key={i}
              className="absolute rounded-full"
              style={{
                left: `calc(50% + ${(i - 1) * 9}px)`,
                bottom: size * 0.32,
                width: 3,
                height: 3,
                background: "rgba(240,163,92,0.9)",
                boxShadow: "0 0 6px rgba(240,163,92,0.8)",
                animation: `ember-rise 2.2s ease-out ${i * 0.7}s infinite`,
              }}
            />
          ))}
      </div>

      <div className="text-center">
        <p className={`font-display font-medium text-text-secondary ${compact ? "text-xs" : "text-sm"}`}>
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
