"use client";

import React from "react";
import clsx from "clsx";
import { RiskStatus } from "@/lib/types";
import { StatusGlyph } from "@/lib/status";

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
  return (
    <div className="rounded-xl bg-bg-surface p-4">
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
        {loading ? "—" : value}
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
