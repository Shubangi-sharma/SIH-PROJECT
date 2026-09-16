"use client";

/**
 * About System — static explainer of the three-service architecture, the
 * data provenance rules, and the two classification vocabularies. Pure
 * documentation surface (brief §nav "About System"); no data fetching.
 */

import React from "react";
import Link from "next/link";
import { Brain, Database, Server, Satellite } from "lucide-react";
import { MODEL_CLASSES, MODEL_CLASS_LABELS } from "@/lib/mlApi";
import { STATUS_META, STATUS_ORDER } from "@/lib/types";
import { StatusGlyph } from "@/lib/status";

export default function AboutPage() {
  return (
    <div className="pyro-scroll h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[860px] flex-col gap-6 p-6 pb-20">
        <header className="pt-4">
          <h1 className="font-display text-2xl font-semibold text-text-primary">
            About System
          </h1>
          <p className="mt-1 text-sm leading-relaxed text-text-secondary">
            PyroSense detects, classifies, and prioritizes industrial thermal
            anomalies from NASA FIRMS satellite data — grounded entirely in real
            stored observations, never invented values.
          </p>
        </header>

        {/* three services */}
        <section className="rounded-xl bg-bg-surface p-5">
          <h2 className="font-display text-base font-semibold text-text-primary">
            Architecture — three services
          </h2>
          <div className="mt-4 grid gap-3">
            {[
              {
                icon: Satellite,
                title: "Frontend (Next.js 14, port 3000)",
                body: "Pure presentation. No secrets, no computation, no direct database access — every number on every page arrives from an API.",
              },
              {
                icon: Server,
                title: "Monitoring backend (Node/Express + SQLite WAL, port 4000)",
                body: "FIRMS ingestion (5-day-chunk backfill + 15-minute refresh), OSM facility matching, thermal fingerprinting, What-Changed analysis, risk/health scoring, grounded GenAI narratives, and the ML proxy.",
              },
              {
                icon: Brain,
                title: "ML classification service (Python FastAPI, port 5000)",
                body: "The trained gradient-boosting model: 36-feature frozen schema → category + per-class probabilities + risk score + grounded explanation. Feature engineering for any submitted point happens here.",
              },
            ].map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex gap-3 rounded-lg border border-border-hairline bg-bg-inset p-3.5">
                <Icon size={16} className="mt-0.5 flex-shrink-0 text-accent-primary" />
                <div>
                  <p className="text-sm font-medium text-text-primary">{title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-text-secondary">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* data provenance */}
        <section className="rounded-xl bg-bg-surface p-5">
          <h2 className="font-display text-base font-semibold text-text-primary">
            Data provenance
          </h2>
          <ul className="mt-3 space-y-2 text-xs leading-relaxed text-text-secondary">
            <li className="flex gap-2">
              <Database size={13} className="mt-0.5 flex-shrink-0 text-accent-secondary" />
              <span>
                <strong className="text-text-primary">NASA FIRMS (VIIRS S-NPP NRT)</strong>{" "}
                — active-fire detections ingested in 5-day chunks (the API&apos;s
                hard cap) over a 365-day rolling window, refreshed every 15
                minutes. The archive&apos;s actual coverage is reported, never promised.
              </span>
            </li>
            <li className="flex gap-2">
              <Database size={13} className="mt-0.5 flex-shrink-0 text-accent-secondary" />
              <span>
                <strong className="text-text-primary">OpenStreetMap Overpass</strong> —
                industrial facility catalogue, ingested monthly; live requests never
                touch Overpass.
              </span>
            </li>
            <li className="flex gap-2">
              <Database size={13} className="mt-0.5 flex-shrink-0 text-accent-secondary" />
              <span>
                <strong className="text-text-primary">Dynamic Earth + Open-Meteo</strong> —
                land-cover and weather features, computed per-point by the ML service
                during prediction.
              </span>
            </li>
            <li className="flex gap-2">
              <Database size={13} className="mt-0.5 flex-shrink-0 text-accent-secondary" />
              <span>
                <strong className="text-text-primary">Grounded GenAI</strong> — summaries
                and explanations are generated only from computed facts (temperature 0),
                with deterministic template fallbacks. A missing source shows an honest
                empty state — never a placeholder number.
              </span>
            </li>
          </ul>
        </section>

        {/* two vocabularies */}
        <section className="rounded-xl bg-bg-surface p-5">
          <h2 className="font-display text-base font-semibold text-text-primary">
            Two classification vocabularies — and why they differ
          </h2>
          <div className="mt-4 grid gap-5 md:grid-cols-2">
            <div>
              <h3 className="text-[11px] font-semibold uppercase tracking-widest text-text-tertiary">
                Risk Status (rule-based, monitoring)
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">
                Real-time behavioural classification of monitored facilities,
                computed by comparing recent detections against each site&apos;s
                own recency-weighted baseline.
              </p>
              <div className="mt-3 grid gap-1.5">
                {STATUS_ORDER.map((s) => (
                  <div key={s} className="flex items-center gap-2">
                    <StatusGlyph status={s} size={9} />
                    <span className="text-xs text-text-secondary">{STATUS_META[s].label}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-[11px] font-semibold uppercase tracking-widest text-text-tertiary">
                Predicted Hotspot Category (ML model)
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">
                The supervised model&apos;s output for a submitted point, trained
                on labelled historical hotspots. Shown on the{" "}
                <Link href="/predict" className="text-accent-primary hover:text-accent-secondary">
                  Predict
                </Link>{" "}
                page.
              </p>
              <div className="mt-3 grid gap-1.5">
                {MODEL_CLASSES.map((c) => (
                  <div key={c} className="flex items-center gap-2">
                    <span className="inline-block h-[9px] w-[9px] rounded-full bg-accent-primary/60" />
                    <span className="font-mono text-[11px] text-text-secondary">
                      {MODEL_CLASS_LABELS[c]}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
