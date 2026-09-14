"use client";

import React from "react";
import { Sparkles } from "lucide-react";

export default function AiSummaryBlock({ text }: { text: string }) {
  return (
    <section className="rounded-r-lg border-l-[3px] border-accent-violet bg-bg-raised p-4">
      <div className="flex items-center gap-1.5">
        <Sparkles size={13} className="text-accent-violet" />
        <span className="font-body text-[11px] font-semibold uppercase tracking-widest text-accent-violet">
          AI Summary
        </span>
      </div>
      <p className="mt-2 font-body text-sm leading-[22px] text-text-primary">
        {text}
      </p>
    </section>
  );
}
