"use client";

/**
 * PinButton — "Add to comparison" toggle (Track D pin affordance).
 *
 * Writes to the shared compare-selection store (lib/compare.ts) — the same
 * store the Compare page reads — so a pin made here survives navigation.
 * Max 3 pins (COMPARE_MAX); at capacity the button communicates "full"
 * instead of silently failing.
 *
 * `asIcon` renders a borderless icon button for embedding inside clickable
 * cards/links (it stops propagation so the card's own click never fires).
 */

import { Pin, PinOff } from "lucide-react";
import clsx from "clsx";
import { COMPARE_MAX, useCompareIds } from "@/lib/compare";

export default function PinButton({
  facilityId,
  facilityName,
  asIcon = false,
  className,
}: {
  facilityId: string;
  facilityName?: string;
  asIcon?: boolean;
  className?: string;
}) {
  const { isPinned, toggle, isFull, ids } = useCompareIds();
  const pinned = isPinned(facilityId);
  const blocked = !pinned && isFull;
  const label = pinned
    ? `Remove ${facilityName ?? "facility"} from comparison`
    : blocked
      ? `Comparison is full (${COMPARE_MAX} max)`
      : `Pin ${facilityName ?? "facility"} for comparison (${ids.length}/${COMPARE_MAX})`;

  if (asIcon) {
    return (
      <button
        type="button"
        aria-label={label}
        aria-pressed={pinned}
        title={label}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          toggle(facilityId);
        }}
        onKeyDown={(e) => {
          // stop the wrapping Link from navigating on keyboard activation
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            toggle(facilityId);
          }
        }}
        className={clsx(
          "relative z-10 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg transition-colors duration-150",
          pinned
            ? "bg-accent-primary/20 text-accent-primary ring-1 ring-accent-primary/40"
            : blocked
              ? "text-text-tertiary/50"
              : "text-text-tertiary hover:bg-bg-raised hover:text-text-primary",
          className,
        )}
      >
        {pinned ? <PinOff size={13} /> : <Pin size={13} />}
      </button>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={pinned}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(facilityId);
      }}
      className={clsx(
        "flex w-full items-center justify-center gap-2 rounded-lg border py-2.5 text-xs font-medium transition-colors duration-150",
        pinned
          ? "border-accent-primary/40 bg-accent-primary/15 text-accent-primary hover:bg-accent-primary/25"
          : blocked
            ? "cursor-not-allowed border-border-hairline bg-bg-raised text-text-tertiary"
            : "border-border-hairline bg-bg-raised text-text-secondary hover:border-border-strong hover:text-text-primary",
        className,
      )}
      title={label}
    >
      {pinned ? <PinOff size={13} /> : <Pin size={13} />}
      {pinned ? "Pinned for comparison" : blocked ? `Comparison full (${COMPARE_MAX})` : "Pin for comparison"}
    </button>
  );
}
