"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  ChevronsLeft,
  ChevronsRight,
  Crosshair,
  Factory,
  GitCompareArrows,
  Info,
  LayoutDashboard,
  Map as MapIcon,
  MessageCircle,
  Settings,
} from "lucide-react";
import BrandMark from "@/components/BrandMark";
import clsx from "clsx";

/**
 * Sidebar arrangement, grouped by operator workflow:
 *   MONITOR: Command Dashboard, Hotspot Map
 *   ANALYZE: Hotspot Classifier, Analytics, Compare, Facility Explorer
 *   SYSTEM:  AI Assistant, Settings, About System
 */
export const NAV_GROUPS: {
  group: string;
  items: { href: string; label: string; icon: React.ElementType }[];
}[] = [
  {
    group: "Monitor",
    items: [
      { href: "/dashboard", label: "Command Dashboard", icon: LayoutDashboard },
      { href: "/map", label: "Hotspot Map", icon: MapIcon },
    ],
  },
  {
    group: "Analyze",
    items: [
      { href: "/predict", label: "Hotspot Classifier", icon: Crosshair },
      { href: "/analytics", label: "Analytics", icon: BarChart3 },
      { href: "/compare", label: "Compare", icon: GitCompareArrows },
      { href: "/facilities", label: "Facility Explorer", icon: Factory },
    ],
  },
  {
    group: "System",
    items: [
      { href: "/chat", label: "AI Assistant", icon: MessageCircle },
      { href: "/settings", label: "Settings", icon: Settings },
      { href: "/about", label: "About System", icon: Info },
    ],
  },
];

/** Flat list (active-route detection + tests). */
export const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

export default function LeftNav({ collapsed, onToggleCollapse }: {
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const pathname = usePathname();

  return (
    <aside
      className={clsx(
        "flex flex-shrink-0 flex-col border-r border-white/[0.05] transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]",
        collapsed ? "w-[72px]" : "w-[240px]",
      )}
      style={{
        background:
          "linear-gradient(180deg, rgba(12, 16, 21, 0.92) 0%, rgba(13, 17, 22, 0.96) 55%, rgba(11, 14, 18, 0.96) 100%)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
      }}
    >
      {/* brand rail — mirrors the TopBar glyph so the chrome reads as one piece */}
      <div
        className={clsx(
          "flex h-[56px] flex-shrink-0 items-center border-b border-white/[0.05]",
          collapsed ? "justify-center" : "px-4",
        )}
      >
        <Link href="/" aria-label="PYROSENSE home" className="flex items-center gap-2">
          <BrandMark size={22} />
          {!collapsed && (
            <span className="font-display text-sm font-semibold tracking-[0.02em] text-text-primary">
              PYRO<span className="text-accent-primary">SENSE</span>
            </span>
          )}
        </Link>
      </div>

      <nav className="pyro-scroll flex-1 overflow-y-auto px-3 py-3" aria-label="Primary">
        {NAV_GROUPS.map(({ group, items }, gi) => (
          <div key={group} className={clsx(gi > 0 && "mt-4")}>
            {!collapsed && (
              <p className="mb-1.5 px-3 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-text-tertiary/70">
                {group}
              </p>
            )}
            {collapsed && gi > 0 && <div className="mx-auto mb-3 h-px w-6 bg-white/[0.06]" aria-hidden />}
            <div className="flex flex-col gap-0.5">
              {items.map(({ href, label, icon: Icon }) => {
                const active = pathname === href || pathname.startsWith(`${href}/`);
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={clsx(
                      "group relative flex h-10 items-center gap-3 rounded-xl px-3 transition-all duration-200",
                      active
                        ? "text-accent-primary"
                        : "text-text-secondary hover:bg-white/[0.03] hover:text-text-primary",
                      collapsed && "justify-center px-0",
                    )}
                  >
                    {/* active indicator — gradient pill + soft fill */}
                    {active && (
                      <>
                        <span
                          aria-hidden
                          className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r"
                          style={{
                            background:
                              "linear-gradient(180deg, #5B9BD5 0%, #4FB3B3 100%)",
                            boxShadow: "0 0 10px rgba(91, 155, 213, 0.5)",
                          }}
                        />
                        <span
                          aria-hidden
                          className="absolute inset-0 rounded-xl border border-accent-primary/20"
                          style={{
                            background:
                              "linear-gradient(90deg, rgba(91, 155, 213, 0.1) 0%, rgba(79, 179, 179, 0.05) 100%)",
                          }}
                        />
                      </>
                    )}
                    <span className="relative flex h-5 w-5 flex-shrink-0 items-center justify-center">
                      <Icon size={17} />
                    </span>
                    {!collapsed && (
                      <span className="relative truncate text-[13px] font-medium">
                        {label}
                      </span>
                    )}
                    {collapsed && (
                      <span
                        role="tooltip"
                        className="pointer-events-none absolute left-[calc(100%+10px)] z-50 whitespace-nowrap rounded-lg border border-border-hairline bg-bg-raised/95 px-3 py-1.5 text-xs text-text-primary opacity-0 shadow-card-elevated backdrop-blur-xl transition-opacity duration-200 group-hover:opacity-100"
                      >
                        {label}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/[0.05] p-3">
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          className="flex h-11 w-full items-center justify-center rounded-xl text-text-tertiary transition-all duration-200 hover:bg-white/[0.03] hover:text-text-primary"
        >
          {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
        </button>
      </div>
    </aside>
  );
}
