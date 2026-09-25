"use client";

import React from "react";
import clsx from "clsx";
import { RiskStatus } from "@/lib/types";
import { StatusGlyph } from "@/lib/status";

/** Maps tone to a CSS custom property for the gradient accent. */
const ACCENT_MAP: Record<string, string> = {
  critical: "rgba(224, 96, 96, 0.4)",
  suspicious: "rgba(224, 138, 82, 0.35)",
  watch: "rgba(224, 168, 76, 0.3)",
  normal: "rgba(78, 203, 160, 0.3)",
  default: "rgba(91, 155, 213, 0.3)",
};

export default function StatTile({
  label,
  value,
  tone,
  toneStatus,
  loading = false,
}: {
  label: string;
  value: number;
  /** "critical" | "suspicious" colour the number; undefined leaves text-primary */
  tone?: "critical" | "suspicious";
  toneStatus?: RiskStatus;
  loading?: boolean;
}) {
  const accentColor =
    ACCENT_MAP[tone ?? toneStatus ?? "default"] ?? ACCENT_MAP.default;

  return (
    <div
      className="dash-card dash-stat rounded-xl p-4"
      style={
        {
          "--stat-accent": accentColor,
        } as React.CSSProperties
      }
    >
      <div
        className={clsx(
          "font-display text-[28px] font-semibold leading-none tracking-tight",
          loading && "animate-pulse",
          tone === "critical"
            ? "text-status-critical"
            : tone === "suspicious"
              ? "text-status-suspicious"
              : "text-text-primary",
        )}
      >
        {loading ? "-" : value}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        {toneStatus && <StatusGlyph status={toneStatus} size={7} />}
        <span className="font-body text-xs uppercase tracking-wide text-text-secondary">
          {label}
        </span>
      </div>
    </div>
  );
}
