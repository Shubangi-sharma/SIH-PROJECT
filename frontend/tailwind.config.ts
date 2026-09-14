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
          void: "#07090B",
          base: "#0B0E11",
          surface: "#101418",
          raised: "#151A20",
          inset: "#0D1114",
        },
        border: {
          hairline: "#1A2028",
          strong: "#262E38",
        },
        text: {
          primary: "#C6CDD6",
          secondary: "#78808C",
          tertiary: "#525A66",
        },
        status: {
          normal: "#5FA97C",
          watch: "#B99B5E",
          suspicious: "#C08A62",
          critical: "#C26A6A",
          unknown: "#5D6570",
        },
        accent: {
          primary: "#6E93BE",
          secondary: "#5CA0AD",
          violet: "#9186C4",
        },
      },
      fontFamily: {
        display: ["var(--font-space-grotesk)", "sans-serif"],
        body: ["var(--font-inter)", "sans-serif"],
        mono: ["var(--font-jetbrains-mono)", "monospace"],
      },
      keyframes: {
        "pulse-glow": {
          "0%, 100%": { opacity: "1", boxShadow: "0 0 0 0 rgba(194, 106, 106, 0.35)" },
          "50%": { opacity: "0.8", boxShadow: "0 0 14px 4px rgba(194, 106, 106, 0.15)" },
        },
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "typing-dot": {
          "0%, 60%, 100%": { transform: "translateY(0)", opacity: "0.4" },
          "30%": { transform: "translateY(-3px)", opacity: "1" },
        },
      },
      animation: {
        "pulse-glow": "pulse-glow 2.5s ease-in-out infinite",
        "fade-in": "fade-in 240ms ease-out both",
        "typing-dot": "typing-dot 1.2s ease-in-out infinite",
      },
      transitionDuration: {
        DEFAULT: "150ms",
      },
    },
  },
  plugins: [],
};

export default config;
