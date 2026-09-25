"use client";

import clsx from "clsx";

/**
 * FreshnessBadge — renders the Phase 3 contract's honesty in one chip:
 * "as of {data_timestamp}" plus the stale/cached state, so the map never
 * implies live certainty (LIMITATIONS.md §8; PDF §17 FIRMS-delay mitigation).
 *
 * Purely presentational: the caller passes the `meta` block from any /api/v1
 * response; relative-age wording is derived here, computation-free.
 */

export interface MetaLike {
  data_timestamp?: string | null;
  stale?: boolean;
  cached?: boolean;
  age_ms?: number;
}

function formatAge(ms: number): string {
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} h ago`;
  return `${Math.floor(ms / 86_400_000)} d ago`;
}

export default function FreshnessBadge({
  meta,
  label = "Data as of",
  className,
}: {
  meta: MetaLike | null | undefined;
  label?: string;
  className?: string;
}) {
  if (!meta?.data_timestamp) {
    return (
      <span
        role="status"
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-md border border-border-hairline bg-bg-raised/95 px-2 py-1 font-mono text-[10px] text-text-tertiary",
          className,
        )}
      >
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-text-tertiary/60" />
        no data timestamp
      </span>
    );
  }

  const ts = new Date(meta.data_timestamp);
  const ageMs = meta.age_ms ?? (Number.isFinite(ts.getTime()) ? Date.now() - ts.getTime() : NaN);
  /* stale ≠ cached: `stale` means the ML service was unreachable and last-known-good
     data was served (warning); `cached` is a normal cache hit whose data is still
     current (neutral). Conflating them showed "just now · stale" on healthy reads. */
  const stale = Boolean(meta.stale);
  const cached = !stale && Boolean(meta.cached);
  const ageText = Number.isFinite(ageMs) ? formatAge(ageMs) : null;

  return (
    <span
      role="status"
      title={
        stale
          ? "Serving the last known good data - the ML service is unreachable"
          : cached
            ? "Served from cache - same data as the previous request"
            : undefined
      }
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10px]",
        stale
          ? "border-border-strong bg-bg-void/90 text-status-watch"
          : "border-border-hairline bg-bg-raised/95 text-text-secondary",
        className,
      )}
    >
      <span
        className={clsx(
          "inline-block h-1.5 w-1.5 rounded-full",
          stale ? "bg-status-watch" : "bg-accent-secondary",
        )}
      />
      {label}{" "}
      <span className="text-text-primary">
        {ts.toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </span>
      {ageText && <span className="text-text-tertiary">· {ageText}</span>}
      {cached && <span className="text-text-tertiary">· cached</span>}
      {stale && <span className="uppercase tracking-wider">· stale</span>}
    </span>
  );
}
