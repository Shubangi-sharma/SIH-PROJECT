"use client";

import React, { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import TopBar from "@/components/TopBar";
import LeftNav from "@/components/LeftNav";
import AmbientDust from "@/components/AmbientDust";
import { useAnalyses } from "@/lib/hooks";
import { REGION_BBOXES } from "@/lib/regions";

/**
 * Shared application shell: TopBar + collapsible LeftNav around every page.
 * Lives in the root layout so each route renders its own content only.
 *
 * The landing page (`/`) renders WITHOUT the shell chrome — full-screen
 * cinematic hero. Every other route gets the standard shell.
 */
export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  // Default collapsed = the 72px icon rail (spec §2)
  const [collapsed, setCollapsed] = useState(true);

  const { analyses } = useAnalyses(REGION_BBOXES.india);

  const unreadCritical = useMemo(
    () => analyses.filter((a) => a.status === "critical").length,
    [analyses],
  );

  // Landing page — no shell chrome
  if (pathname === "/") {
    return <>{children}</>;
  }

  return (
    <div className="relative isolate flex h-screen flex-col overflow-hidden bg-bg-void">
      {/* sparkle dust behind all chrome — landing page runs its own field */}
      <AmbientDust />
      <TopBar unreadCritical={unreadCritical} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <LeftNav
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((c) => !c)}
        />
        {/* pages own their scrolling; /map fills the frame edge-to-edge */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}

