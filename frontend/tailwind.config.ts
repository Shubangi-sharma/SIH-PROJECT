import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          void: "#050709",
          base: "#0A0D10",
          surface: "#0F1318",
          raised: "#141920",
          inset: "#0C0F13",
          elevated: "#1A2028",
        },
        border: {
          hairline: "#1A2028",
          subtle: "#1F2733",
          strong: "#2A3444",
        },
        text: {
          primary: "#E6ECF4",
          secondary: "#96A3B5",
          tertiary: "#6B7787",
        },
        status: {
          normal: "#4ECBA0",
          watch: "#E0A84C",
          suspicious: "#E08A52",
          critical: "#E06060",
          unknown: "#5D6570",
        },
        accent: {
          primary: "#5B9BD5",
          secondary: "#4FB3B3",
          violet: "#9186C4",
          rose: "#D47898",
          ember: "#E08A52",
        },
        glow: {
          blue: "rgba(91, 155, 213, 0.12)",
          teal: "rgba(79, 179, 179, 0.10)",
          rose: "rgba(212, 120, 152, 0.08)",
        },
      },
      fontFamily: {
        display: ["var(--font-space-grotesk)", "sans-serif"],
        body: ["var(--font-inter)", "sans-serif"],
        mono: ["var(--font-jetbrains-mono)", "monospace"],
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic": "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
        "gradient-mesh":
          "radial-gradient(at 27% 37%, rgba(91,155,213,0.06) 0px, transparent 50%), radial-gradient(at 97% 21%, rgba(79,179,179,0.04) 0px, transparent 50%), radial-gradient(at 52% 99%, rgba(145,134,196,0.04) 0px, transparent 50%)",
        "card-sheen":
          "linear-gradient(180deg, rgba(255,255,255,0.028) 0%, rgba(255,255,255,0) 34%), radial-gradient(120% 140% at 12% 0%, rgba(91,155,213,0.055) 0%, rgba(79,179,179,0.03) 42%, transparent 72%), radial-gradient(100% 120% at 95% 100%, rgba(145,134,196,0.045) 0%, transparent 60%)",
        "panel-tint":
          "linear-gradient(180deg, rgba(20,26,34,0.72) 0%, rgba(13,17,22,0.72) 100%)"
      },
      boxShadow: {
        glow: "0 0 20px rgba(91, 155, 213, 0.08), 0 0 60px rgba(91, 155, 213, 0.04)",
        "glow-teal": "0 0 20px rgba(79, 179, 179, 0.08), 0 0 60px rgba(79, 179, 179, 0.04)",
        "card-hover": "0 8px 32px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(91, 155, 213, 0.06)",
        "card-elevated": "0 16px 48px rgba(0, 0, 0, 0.3)",
      },
      keyframes: {
        "pulse-glow": {
          "0%, 100%": { opacity: "1", boxShadow: "0 0 0 0 rgba(224, 96, 96, 0.35)" },
          "50%": { opacity: "0.8", boxShadow: "0 0 14px 4px rgba(224, 96, 96, 0.15)" },
        },
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "typing-dot": {
          "0%, 60%, 100%": { transform: "translateY(0)", opacity: "0.4" },
          "30%": { transform: "translateY(-3px)", opacity: "1" },
        },
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(24px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "slide-up": {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "glow-pulse": {
          "0%, 100%": { opacity: "0.4" },
          "50%": { opacity: "1" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
        "border-glow": {
          "0%, 100%": { borderColor: "rgba(91, 155, 213, 0.08)" },
          "50%": { borderColor: "rgba(91, 155, 213, 0.16)" },
        },
        "ember-rise": {
          "0%": { transform: "translateY(6px) scale(0.6)", opacity: "0" },
          "18%": { opacity: "1" },
          "70%": { opacity: "0.9" },
          "100%": { transform: "translateY(-26px) scale(1.05)", opacity: "0" },
        },
        "sweep": {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(360deg)" },
        },
      },
      animation: {
        "pulse-glow": "pulse-glow 2.5s ease-in-out infinite",
        "fade-in": "fade-in 240ms ease-out both",
        "typing-dot": "typing-dot 1.2s ease-in-out infinite",
        "fade-up": "fade-up 0.6s cubic-bezier(0.16, 1, 0.3, 1) both",
        shimmer: "shimmer 2s linear infinite",
        "slide-up": "slide-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) both",
        "glow-pulse": "glow-pulse 3s ease-in-out infinite",
        float: "float 6s ease-in-out infinite",
        "border-glow": "border-glow 4s ease-in-out infinite",
        "ember-rise": "ember-rise 2.2s ease-out infinite",
        sweep: "sweep 7s linear infinite",
      },
      transitionDuration: {
        DEFAULT: "150ms",
      },
    },
  },
  plugins: [],
};

export default config;
