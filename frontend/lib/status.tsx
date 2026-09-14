"use client";

import React from "react";
import { STATUS_META, RiskStatus, statusColorHex } from "./types";
import clsx from "clsx";

/**
 * Distinct geometric shape per status (§9: never colour alone).
 * dot • diamond ◆ triangle ▲ octagon ⯃ square ■
 */
export function StatusGlyph({
  status,
  size = 8,
  className,
}: {
  status: RiskStatus;
  size?: number;
  className?: string;
}) {
  const hex = statusColorHex(status);
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 10 10",
    className,
    "aria-hidden": true as const,
  };
  switch (STATUS_META[status].shape) {
    case "diamond":
      return (
        <svg {...common}>
          <rect x="2" y="2" width="6" height="6" transform="rotate(45 5 5)" fill={hex} />
        </svg>
      );
    case "triangle":
      return (
        <svg {...common}>
          <polygon points="5,1 9.4,9 0.6,9" fill={hex} />
        </svg>
      );
    case "octagon": {
      // regular octagon, vertices on r=4.6 circle centred at 5,5
      const pts = Array.from({ length: 8 }, (_, i) => {
        const a = (Math.PI / 4) * i + Math.PI / 8;
        return `${(5 + 4.6 * Math.cos(a)).toFixed(2)},${(5 + 4.6 * Math.sin(a)).toFixed(2)}`;
      }).join(" ");
      return (
        <svg {...common}>
          <polygon points={pts} fill={hex} />
        </svg>
      );
    }
    case "square":
      return (
        <svg {...common}>
          <rect x="1.4" y="1.4" width="7.2" height="7.2" rx="1" fill={hex} />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="5" cy="5" r="4.2" fill={hex} />
        </svg>
      );
  }
}

/** Pill badge: status colour background tint + matching shape glyph. */
export function StatusBadge({
  status,
  className,
}: {
  status: RiskStatus;
  className?: string;
}) {
  const hex = statusColorHex(status);
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5",
        "font-body text-[11px] font-medium uppercase tracking-wider",
        className,
      )}
      style={{ backgroundColor: `${hex}24`, color: hex }}
    >
      <StatusGlyph status={status} size={8} />
      {STATUS_META[status].label}
    </span>
  );
}

/** Legend / list row marker: shape glyph + label (Inter 12px). */
export function StatusLegendRow({
  status,
  label,
}: {
  status: RiskStatus;
  label: string;
}) {
  return (
    <span className="flex items-center gap-2">
      <StatusGlyph status={status} size={9} />
      <span className="font-body text-xs text-text-secondary">{label}</span>
    </span>
  );
}
