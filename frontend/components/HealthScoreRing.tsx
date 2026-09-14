"use client";

import React from "react";
import { RiskStatus, statusColorHex } from "@/lib/types";
import { StatusBadge } from "@/lib/status";

const SIZE = 120;
const STROKE = 8;
const R = (SIZE - STROKE) / 2;
const C = 2 * Math.PI * R;

export default function HealthScoreRing({
  score,
  status,
}: {
  score: number;
  status: RiskStatus;
}) {
  const hex = statusColorHex(status);
  const offset = C * (1 - Math.max(0, Math.min(100, score)) / 100);

  return (
    <div
      className="flex flex-col items-center gap-3"
      role="img"
      aria-label={`Thermal health score ${score} of 100 — ${status}`}
    >
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} className="-rotate-90">
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke="#1A2028"
            strokeWidth={STROKE}
          />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke={hex}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 400ms ease, stroke 400ms ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex items-baseline">
            <span className="font-display text-[32px] font-semibold leading-none text-text-primary">
              {score}
            </span>
            <span className="ml-1 font-mono text-xs text-text-tertiary">/100</span>
          </div>
        </div>
      </div>
      <StatusBadge status={status} />
    </div>
  );
}
