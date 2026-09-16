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
  Info,
  LayoutDashboard,
  Map as MapIcon,
  MessageCircle,
  Settings,
} from "lucide-react";
import clsx from "clsx";

/**
 * Superset of the brief's suggested order (Dashboard | Hotspot Map |
 * Analytics | Predict | About System) plus the pages already built.
 */
export const NAV_ITEMS = [
  { href: "/", label: "Command Dashboard", icon: LayoutDashboard },
  { href: "/map", label: "Hotspot Map", icon: MapIcon },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/predict", label: "Predict", icon: Crosshair },
  { href: "/about", label: "About System", icon: Info },
  { href: "/facilities", label: "Facility Explorer", icon: Factory },
  { href: "/chat", label: "AI Assistant", icon: MessageCircle },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export default function LeftNav({
  collapsed,
  onToggleCollapse,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const pathname = usePathname();

  return (
    <aside
      className={clsx(
        "flex flex-shrink-0 flex-col border-r border-border-hairline bg-bg-surface transition-[width] duration-300",
        collapsed ? "w-[72px]" : "w-[240px]",
      )}
    >
      <nav className="flex flex-col gap-1 p-3" aria-label="Primary">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={clsx(
                "group relative flex h-11 items-center gap-3 rounded-lg px-3 transition-colors duration-150",
                active
                  ? "bg-accent-primary/15 text-accent-primary"
                  : "text-text-secondary hover:bg-bg-raised hover:text-text-primary",
                collapsed && "justify-center px-0",
              )}
            >
              {active && (
                <span
                  aria-hidden
                  className="absolute left-0 top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-r bg-accent-primary"
                />
              )}
              <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center">
                <Icon size={18} />
              </span>
              {!collapsed && (
                <span className="truncate text-[13px] font-medium">{label}</span>
              )}
              {collapsed && (
                <span
                  role="tooltip"
                  className="pointer-events-none absolute left-[calc(100%+10px)] z-50 whitespace-nowrap rounded-md border border-border-hairline bg-bg-raised px-2 py-1 text-xs text-text-primary opacity-0 shadow-lg shadow-black/40 transition-opacity duration-150 group-hover:opacity-100"
                >
                  {label}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-border-hairline p-3">
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          className={clsx(
            "flex h-11 w-full items-center justify-center rounded-lg text-text-tertiary transition-colors duration-150 hover:bg-bg-raised hover:text-text-primary",
          )}
        >
          {collapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
        </button>
      </div>
    </aside>
  );
}
