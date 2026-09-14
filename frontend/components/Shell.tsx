"use client";

import React, { useMemo, useState } from "react";
import TopBar from "@/components/TopBar";
import LeftNav from "@/components/LeftNav";
import { useAnalyses } from "@/lib/hooks";
import { REGION_BBOXES } from "@/lib/regions";

/**
 * Shared application shell: TopBar + collapsible LeftNav around every page.
 * Lives in the root layout so each route renders its own content only.
 * The critical-alert count comes from the backend's computed analyses —
 * the same shared SWR cache every page uses: one shared fetch, no
 * duplicated requests (§5).
 */
export default function Shell({ children }: { children: React.ReactNode }) {
  // Default collapsed = the 72px icon rail (spec §2)
  const [collapsed, setCollapsed] = useState(true);

  const { analyses } = useAnalyses(REGION_BBOXES.india);

  const unreadCritical = useMemo(
    () => analyses.filter((a) => a.status === "critical").length,
    [analyses],
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg-void">
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

