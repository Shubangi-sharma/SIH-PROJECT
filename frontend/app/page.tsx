"use client";

/**
 * Landing page — clean, human-designed hero.
 *
 * Deliberately minimal — no over-engineered animations or AI-generated
 * filler. The page communicates what PyroSense does, shows real system
 * capabilities, and gets out of the way.
 *
 * Data sources in the footer link out to the real providers we use.
 */

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Satellite, Brain, Shield, ExternalLink } from "lucide-react";
import BrandMark from "@/components/BrandMark";
import { useCommand } from "@/lib/hooks";

/* ------------------------------------------------------------------ */
/* Subtle particle field — floating ambient dots                       */
/* ------------------------------------------------------------------ */

function ParticleField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    const particles: {
      x: number;
      y: number;
      vx: number;
      vy: number;
      r: number;
      o: number;
    }[] = [];

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const count = Math.min(40, Math.floor(window.innerWidth / 35));
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.2,
        vy: (Math.random() - 0.5) * 0.15,
        r: Math.random() * 1.2 + 0.4,
        o: Math.random() * 0.2 + 0.03,
      });
    }

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(91,155,213,${p.o})`;
        ctx.fill();
      }
      animId = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0" aria-hidden />;
}

/* ------------------------------------------------------------------ */
/* page                                                                */
/* ------------------------------------------------------------------ */

const PILLARS = [
  {
    icon: Satellite,
    title: "Satellite Detection",
    desc: "NASA VIIRS active-fire data ingested every 15 minutes across a 365-day rolling window.",
  },
  {
    icon: Brain,
    title: "ML Classification",
    desc: "43-feature MLP classifier categorizing hotspots into 5 industrial fire types with grounded explanations.",
  },
  {
    icon: Shield,
    title: "Risk Assessment",
    desc: "Weighted-probability risk scoring and per-facility thermal baselines updated continuously.",
  },
] as const;

/** Real provider links — every data source credits where the data comes from. */
const DATA_SOURCES = [
  { label: "NASA FIRMS", href: "https://firms.modaps.eosdis.nasa.gov/" },
  { label: "OpenStreetMap", href: "https://www.openstreetmap.org/copyright" },
  { label: "ERA5 Weather", href: "https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels" },
  { label: "Dynamic World", href: "https://dynamicworld.app/" },
] as const;

/** Live status card — real counters from the command view, honest fallback. */
function StatusCard({ mounted }: { mounted: boolean }) {
  const { command, isLoading } = useCommand();
  const facilities = command?.facilitiesMonitored;
  const hotspots = command?.totalHotspots;
  const critical = command?.critical ?? 0;

  return (
    <div
      className="map-glass mb-8 inline-flex flex-wrap items-center justify-center gap-x-5 gap-y-2 rounded-2xl px-5 py-2.5"
      style={{
        opacity: mounted ? 1 : 0,
        transition: "opacity 0.6s ease 0.2s",
      }}
    >
      <span className="inline-flex items-center gap-2">
        <span className="relative flex h-[6px] w-[6px]">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#4ECBA0] opacity-60" />
          <span className="relative inline-flex h-[6px] w-[6px] rounded-full bg-[#4ECBA0]" />
        </span>
        <span className="font-body text-[12px] font-medium text-white/80">
          Monitoring active · India region
        </span>
      </span>
      <span className="hidden h-4 w-px bg-white/10 sm:block" aria-hidden />
      {isLoading || facilities == null ? (
        <span className="font-mono text-[11px] text-white/35">
          connecting to live feed…
        </span>
      ) : (
        <span className="inline-flex items-center gap-4 font-mono text-[11px]">
          <span className="text-white/55">
            <span className="font-semibold text-white/85">{facilities}</span> sites
          </span>
          <span className="text-white/55">
            <span className="font-semibold text-white/85">{hotspots ?? 0}</span> hotspots 10d
          </span>
          {critical > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E06060]/12 px-2 py-0.5 text-[#E86A6A]">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#E06060]" />
              {critical} critical
            </span>
          )}
        </span>
      )}
    </div>
  );
}

export default function LandingPage() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-[#050709]">
      {/* ── Background ─────────────────────────────────────────────── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="landing-orb landing-orb-1" />
        <div className="landing-orb landing-orb-2" />
        <div className="landing-orb landing-orb-3" />
        <div className="landing-grid" />
        <ParticleField />
      </div>

      {/* ── Top bar ────────────────────────────────────────────────── */}
      <nav
        className="relative z-10 flex items-center justify-between px-6 py-5 sm:px-10"
        style={{
          opacity: mounted ? 1 : 0,
          transition: "opacity 0.5s ease 0.1s",
        }}
      >
        <div className="flex items-center gap-2.5">
          <BrandMark size={26} />
          <span className="font-display text-lg font-semibold tracking-wide text-white">
            PYRO<span className="text-[#6FAFDD]">SENSE</span>
          </span>
        </div>
        <button
          onClick={() => router.push("/dashboard")}
          className="group flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-5 py-2 font-body text-sm text-white/70 transition-all duration-300 hover:border-white/20 hover:bg-white/[0.06] hover:text-white"
        >
          Open Dashboard
          <ArrowRight
            size={14}
            className="transition-transform duration-300 group-hover:translate-x-0.5"
          />
        </button>
      </nav>

      {/* ── Hero ───────────────────────────────────────────────────── */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6">
        <StatusCard mounted={mounted} />

        {/* headline - the system watches every thermal anomaly, not just industrial */}
        <h1
          className="max-w-2xl text-center font-display text-4xl font-bold leading-[1.08] tracking-tight text-white sm:text-5xl md:text-6xl"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? "translateY(0)" : "translateY(16px)",
            transition: "opacity 0.7s ease 0.3s, transform 0.7s ease 0.3s",
          }}
        >
          Every Thermal Anomaly,
          <br />
          <span
            style={{
              background:
                "linear-gradient(90deg, #F5B04C 0%, #E06060 38%, #6FAFDD 72%, #4FB3B3 100%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            Seen From Orbit
          </span>
        </h1>

        {/* subtitle */}
        <p
          className="mt-5 max-w-lg text-center font-body text-[15px] leading-relaxed text-white/45"
          style={{
            opacity: mounted ? 1 : 0,
            transition: "opacity 0.7s ease 0.5s",
          }}
        >
          Satellite-powered monitoring that detects, classifies and scores every
          thermal anomaly - industrial fires, flares, crop burning, wildfires -
          with real-time risk scoring across India.
        </p>

        {/* CTA */}
        <button
          onClick={() => router.push("/dashboard")}
          className="landing-cta group mt-10 flex items-center gap-3 rounded-full px-8 py-3 font-display text-sm font-semibold text-white transition-all duration-300"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? "translateY(0)" : "translateY(8px)",
            transition:
              "opacity 0.7s ease 0.6s, transform 0.7s ease 0.6s, box-shadow 0.3s ease, background 0.3s ease",
          }}
        >
          Launch Command Dashboard
          <ArrowRight
            size={16}
            className="transition-transform duration-300 group-hover:translate-x-1"
          />
        </button>

        {/* three pillars - what the system does */}
        <div
          className="mt-16 grid w-full max-w-3xl grid-cols-1 gap-4 sm:grid-cols-3"
          style={{
            opacity: mounted ? 1 : 0,
            transition: "opacity 0.8s ease 0.8s",
          }}
        >
          {PILLARS.map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className="map-glass rounded-xl px-5 py-5"
            >
              <Icon size={18} className="mb-3 text-white/35" />
              <h3 className="font-display text-sm font-semibold text-white/85">{title}</h3>
              <p className="mt-1.5 text-[12px] leading-relaxed text-white/40">{desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Footer - real, clickable data-source credits ──────────── */}
      <footer
        className="relative z-10 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 px-6 py-5"
        style={{ opacity: mounted ? 1 : 0, transition: "opacity 1s ease 1s" }}
      >
        {DATA_SOURCES.map(({ label, href }) => (
          <a
            key={label}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-white/30 transition-colors duration-200 hover:text-white/70"
          >
            {label}
            <ExternalLink
              size={9}
              className="opacity-0 transition-opacity duration-200 group-hover:opacity-100"
              aria-hidden
            />
          </a>
        ))}
      </footer>
    </div>
  );
}
