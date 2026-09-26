"use client";

/**
 * AmbientDust — tiny sparkly dust motes drifting across the app background.
 *
 * Mounted once in the shared Shell, so the landing page (which runs its own
 * ParticleField) stays untouched. A fixed, pointer-transparent canvas behind
 * all chrome: ~one 0.4–1.3px mote per 18k CSS px², cool blue-white with rare
 * warm gold flecks, each twinkling on its own phase — mostly dim, with brief
 * brighter glints that read as sparkle. Pauses when the tab hides and renders
 * a static sprinkle under prefers-reduced-motion.
 */

import React, { useEffect, useRef } from "react";

type Mote = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** base alpha — the floor of the twinkle. */
  a: number;
  /** twinkle phase offset, radians. */
  phase: number;
  /** glint cycles per second (scaled by π in the draw). */
  twinkle: number;
  /** rare warm gold fleck vs cool blue dust. */
  warm: boolean;
};

export default function AmbientDust() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let motes: Mote[] = [];
    let raf = 0;
    let running = true;

    const seed = () => {
      // canvas is in device px — normalize density to CSS px²
      const count = Math.min(
        70,
        Math.floor((canvas.width * canvas.height) / (18000 * dpr * dpr)),
      );
      motes = Array.from({ length: count }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.06,
        vy: (Math.random() - 0.5) * 0.05,
        r: Math.random() * 0.9 + 0.4,
        a: Math.random() * 0.18 + 0.08,
        phase: Math.random() * Math.PI * 2,
        twinkle: Math.random() * 0.9 + 0.35,
        warm: Math.random() < 0.08,
      }));
    };

    const color = (m: Mote, alpha: number) =>
      m.warm ? `rgba(245,176,76,${alpha})` : `rgba(168,198,232,${alpha})`;

    const drawStatic = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const m of motes) {
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r * dpr, 0, Math.PI * 2);
        ctx.fillStyle = color(m, m.a);
        ctx.fill();
      }
    };

    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      seed();
      if (reduced) drawStatic();
    };

    const draw = (t: number) => {
      if (!running) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const s = t / 1000;
      for (const m of motes) {
        m.x += m.vx * dpr;
        m.y += m.vy * dpr;
        if (m.x < 0) m.x = canvas.width;
        if (m.x > canvas.width) m.x = 0;
        if (m.y < 0) m.y = canvas.height;
        if (m.y > canvas.height) m.y = 0;
        // squaring the sine sharpens the peak — brief glints, mostly dim
        const g = Math.max(0, Math.sin(s * m.twinkle * Math.PI + m.phase));
        const alpha = m.a + g * g * 0.45;
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.r * dpr * (1 + g * 0.4), 0, Math.PI * 2);
        ctx.fillStyle = color(m, alpha);
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };

    const onVisibility = () => {
      running = !document.hidden && !reduced;
      cancelAnimationFrame(raf);
      if (running) raf = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);
    if (reduced) drawStatic();
    else raf = requestAnimationFrame(draw);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10"
    />
  );
}
