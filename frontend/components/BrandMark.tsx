/**
 * BrandMark — the one PyroSense glyph, used everywhere (favicon, top bar,
 * left nav, landing). A single geometric flame with an inner hot core:
 * reads clearly at 16 px and stays balanced next to the wordmark.
 */

export function BrandMarkSvg({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden
      style={{ display: "block", flexShrink: 0 }}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M16 3.5c.35 2.9-.35 5.6-2.1 7.9-.5-1-.85-2.1-1.05-3.3C11.2 10 10 12.7 10 16c0 4.6 2.7 7.7 6 7.7s6-3.1 6-7.7c0-4.8-3.9-7.5-6-12.5Zm0 9.7c1.9 2 2.9 3.9 2.9 5.9 0 2.2-1.3 3.7-2.9 3.7s-2.9-1.5-2.9-3.7c0-2 1-3.9 2.9-5.9Z"
        fill="url(#pyro-mark-ember)"
      />
      <defs>
        <linearGradient
          id="pyro-mark-ember"
          x1="16"
          y1="3.5"
          x2="16"
          y2="23.7"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#F5B04C" />
          <stop offset="0.55" stopColor="#E06060" />
          <stop offset="1" stopColor="#D14D4D" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export default function BrandMark({ size = 24 }: { size?: number }) {
  return <BrandMarkSvg size={size} />;
}
