"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Search, User } from "lucide-react";
import { FacilityAnalysis, STATUS_META, statusColorHex } from "@/lib/types";
import { useAnalyses } from "@/lib/hooks";
import { REGION_BBOXES } from "@/lib/regions";
import clsx from "clsx";

/** Triangular signal glyph — deliberately not a literal flame. */
function SignalMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3 L21 20 H3 Z" stroke="#6E93BE" strokeWidth="2" strokeLinejoin="round" />
      <path d="M12 9.5 L16.4 17.5 H7.6 Z" fill="#6E93BE" />
    </svg>
  );
}

export default function TopBar({ unreadCritical }: { unreadCritical: number }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [bellOpen, setBellOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const rootRef = useRef<HTMLElement>(null);

  // Backend-computed analyses from the shared SWR cache (§5) — no extra calls.
  const { analyses } = useAnalyses(REGION_BBOXES.india);

  /** Critical facilities, most severe first — the bell dropdown's content. */
  const criticalFacilities = useMemo(
    () => analyses.filter((a) => a.status === "critical").slice(0, 8),
    [analyses],
  );

  const criticalCount = useMemo(() => analyses.filter((a) => a.status === "critical").length, [analyses]);
  const suspiciousCount = useMemo(() => analyses.filter((a) => a.status === "suspicious").length, [analyses]);
  const watchCount = useMemo(() => analyses.filter((a) => a.status === "watch").length, [analyses]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return analyses
      .filter((a) => `${a.facility.name} ${a.facility.type}`.toLowerCase().includes(q))
      .slice(0, 6);
  }, [analyses, query]);

  // close menus on outside click / Escape
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setBellOpen(false);
        setAvatarOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setBellOpen(false);
        setAvatarOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <header
      ref={rootRef}
      className="relative z-[1200] flex h-[56px] flex-shrink-0 items-center gap-4 border-b border-border-hairline bg-bg-surface px-4"
    >
      {/* brand */}
      <button
        type="button"
        onClick={() => router.push("/")}
        aria-label="PYROSENSE home"
        className="flex items-center gap-2.5"
      >
        <SignalMark />
        <span className="font-display text-base font-semibold tracking-wide text-text-primary">
          PYRO<span className="text-accent-primary">SENSE</span>
        </span>
      </button>

      {/* search — live, navigates to facility pages */}
      <div className="relative mx-auto hidden w-full max-w-[520px] sm:block">
        <Search
          size={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary"
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) {
              router.push(`/facilities/${results[0].facility.id}`);
              setQuery("");
            }
          }}
          placeholder="Search facility, region, or coordinates…"
          aria-label="Search facilities"
          className="h-9 w-full rounded-lg border border-border-hairline bg-bg-inset pl-9 pr-3 font-mono text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-accent-primary/60 focus:outline-none focus:ring-1 focus:ring-accent-primary/30"
        />
        {results.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-50 mt-1.5 overflow-hidden rounded-lg border border-border-hairline bg-bg-raised shadow-lg shadow-black/50">
            {results.map((a) => {
              const hex = statusColorHex(a.status);
              return (
                <button
                  key={a.facility.id}
                  type="button"
                  onClick={() => {
                    router.push(`/facilities/${a.facility.id}`);
                    setQuery("");
                  }}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors duration-150 hover:bg-bg-surface"
                >
                  <span
                    className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: hex }}
                  />
                  <span className="truncate text-sm text-text-primary">
                    {a.facility.name}
                  </span>
                  <span className="ml-auto flex-shrink-0 font-mono text-[10px] text-text-tertiary">
                    {a.facility.type}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* right cluster */}
      <div className="ml-auto flex items-center gap-2 sm:ml-0 sm:gap-4">
        {/* command counters — always visible */}
        <div className="hidden items-center gap-3 md:flex">
          {analyses.length > 0 ? (
            <>
              <span className="font-mono text-xs text-text-tertiary">
                LIVE · {analyses.length} sites
              </span>
              {criticalCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded bg-status-critical/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-status-critical">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-status-critical" />
                  {criticalCount} CRT
                </span>
              )}
              {suspiciousCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded bg-status-suspicious/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-status-suspicious">
                  {suspiciousCount} SUS
                </span>
              )}
              {watchCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded bg-status-watch/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-status-watch">
                  {watchCount} WTC
                </span>
              )}
            </>
          ) : (
            <span className="font-mono text-xs text-text-tertiary">
              connecting to live feeds…
            </span>
          )}
        </div>

        {/* bell — opens critical alerts dropdown */}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setBellOpen((v) => !v);
              setAvatarOpen(false);
            }}
            aria-label={`Notifications — ${unreadCritical} unread critical`}
            aria-expanded={bellOpen}
            className={clsx(
              "relative flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary transition-colors duration-150 hover:bg-bg-raised hover:text-text-primary",
              bellOpen && "bg-bg-raised text-text-primary",
            )}
          >
            <Bell size={17} />
            {unreadCritical > 0 && (
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-status-critical ring-2 ring-bg-surface" />
            )}
          </button>

          {bellOpen && (
            <div className="absolute right-0 top-full z-50 mt-1.5 w-[320px] overflow-hidden rounded-lg border border-border-hairline bg-bg-raised shadow-lg shadow-black/50">
              <div className="border-b border-border-hairline px-3 py-2 font-body text-[10px] font-semibold uppercase tracking-widest text-text-tertiary">
                Critical alerts · computed from live FIRMS
              </div>
              {criticalFacilities.length === 0 ? (
                <p className="px-3 py-4 text-xs text-text-secondary">
                  No critical facilities right now — all monitored sites within
                  baseline.
                </p>
              ) : (
                criticalFacilities.map((a) => (
                  <button
                    key={a.facility.id}
                    type="button"
                    onClick={() => {
                      router.push(`/facilities/${a.facility.id}`);
                      setBellOpen(false);
                    }}
                    className="flex w-full items-center gap-2.5 border-b border-border-hairline px-3 py-2.5 text-left transition-colors duration-150 last:border-b-0 hover:bg-bg-surface"
                  >
                    <span
                      className="h-2 w-2 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: STATUS_META.critical.hex }}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-text-primary">
                        {a.facility.name}
                      </span>
                      <span className="block truncate font-mono text-[10px] text-text-tertiary">
                        HS {a.score} · {a.detectionCount} det ·{" "}
                        {a.latestFrp != null ? `${a.latestFrp.toFixed(0)} MW` : "n/a"}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* avatar — opens account stub menu */}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setAvatarOpen((v) => !v);
              setBellOpen(false);
            }}
            aria-label="Account menu"
            aria-expanded={avatarOpen}
            className={clsx(
              "flex h-8 w-8 items-center justify-center rounded-full border border-border-hairline bg-bg-raised text-text-secondary transition-colors duration-150 hover:border-border-strong hover:text-text-primary",
              avatarOpen && "border-border-strong text-text-primary",
            )}
          >
            <User size={15} />
          </button>

          {avatarOpen && (
            <div className="absolute right-0 top-full z-50 mt-1.5 w-[220px] overflow-hidden rounded-lg border border-border-hairline bg-bg-raised shadow-lg shadow-black/50">
              <div className="border-b border-border-hairline px-3 py-2.5">
                <p className="text-sm text-text-primary">Station Operator</p>
                <p className="font-mono text-[10px] text-text-tertiary">
                  ops@pyrosense.demo
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  router.push("/settings");
                  setAvatarOpen(false);
                }}
                className="block w-full px-3 py-2.5 text-left text-sm text-text-secondary transition-colors duration-150 hover:bg-bg-surface hover:text-text-primary"
              >
                Settings
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
