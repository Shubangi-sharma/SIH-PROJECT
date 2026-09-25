/**
 * BrandMark — the one PyroSense glyph, used everywhere (favicon, top bar,
 * left nav, landing). A thermal flame inside a locator/scan frame: "we watch
 * heat from orbit". Deliberately not a literal campfire.
 */

export function BrandMarkSvg({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden
    >
      {/* scan frame — rounded corner brackets */}
      <path
        d="M3 10V6.5A3.5 3.5 0 0 1 6.5 3H10"
        stroke="#5B9BD5"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M22 3h3.5A3.5 3.5 0 0 1 29 6.5V10"
        stroke="#5B9BD5"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M29 22v3.5a3.5 3.5 0 0 1-3.5 3.5H22"
        stroke="#5B9BD5"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M10 29H6.5A3.5 3.5 0 0 1 3 25.5V22"
        stroke="#5B9BD5"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      {/* thermal flame */}
      <path
        d="M16 6.8c1.1 3.1 4.9 4.6 4.9 9.2 0 4-2.4 7.2-4.9 7.2s-4.9-3.2-4.9-7.2c0-2.4 1.3-4.4 2.5-5.9.5 1 .9 1.7 2 2.4 0-2.4.1-4.1.4-5.7Z"
        fill="url(#pyro-ember)"
      />
      <defs>
        <linearGradient id="pyro-ember" x1="16" y1="7" x2="16" y2="23.2" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F0A35C" />
          <stop offset="0.55" stopColor="#E06060" />
          <stop offset="1" stopColor="#E06060" stopOpacity="0.55" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export default function BrandMark({ size = 24 }: { size?: number }) {
  return <BrandMarkSvg size={size} />;
}
