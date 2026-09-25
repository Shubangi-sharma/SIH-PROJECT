"use client";

import React from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { WhatChangedRow, statusColorHex } from "@/lib/types";

export default function WhatChangedPanel({
  rows,
}: {
  rows: WhatChangedRow[];
}) {
  return (
    <section className="dash-card rounded-xl p-4">
      <h3 className="font-display text-sm font-semibold text-text-primary">
        What Changed?
      </h3>
      <ul className="mt-3 space-y-2.5">
        {rows.map((row, i) => {
          const sevHex = row.severity ? statusColorHex(row.severity) : "#EAB308";
          return (
            <li key={i} className="flex items-start gap-2.5">
              {row.kind === "ok" ? (
                <CheckCircle2 size={15} className="mt-0.5 flex-shrink-0 text-status-normal" />
              ) : (
                <AlertTriangle
                  size={15}
                  className="mt-0.5 flex-shrink-0"
                  style={{ color: sevHex }}
                />
              )}
              <span className="font-body text-sm leading-snug text-text-primary">
                {row.text}
              </span>
              {row.value && (
                <span
                  className="ml-auto flex-shrink-0 pl-2 font-mono text-[13px] font-semibold"
                  style={{ color: row.severity ? sevHex : "#E6EBF2" }}
                >
                  {row.value}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
