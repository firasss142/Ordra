import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "var(--font-sans)",
          "var(--font-sans-arabic)",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        cairo: [
          "var(--font-cairo)",
          "var(--font-sans-arabic)",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      colors: {
        surface: {
          page: "#F6F6F7",
          card: "#FFFFFF",
          hover: "#FAFAFA",
          selected: "#F2F2F2",
          elevated: "#FFFFFF",
          sunken: "#FAFAFB",
        },
        chart: {
          line: "#8C9196",
        },
        ink: {
          primary: "#1A1A1A",
          secondary: "#6D7175",
          muted: "#9CA3AF",
        },
        line: {
          subtle: "#ECEEF0",
          DEFAULT: "#E1E3E5",
          strong: "#DADCE0",
        },
        accent: {
          DEFAULT: "#10B981",
          soft: "rgba(16,185,129,0.10)",
        },
        status: {
          action: "#2C6ECB",
          success: "#008060",
          successBg: "#F1F8F5",
          warning: "#B98900",
          warningBg: "#FFF8E6",
          critical: "#D72C0D",
          criticalBg: "#FFF4F4",
          neutral: "#6D7175",
          neutralBg: "#F6F6F7",
        },
        agent: {
          bg: "#f4fbf4",
          surface: "#ffffff",
          "surface-low": "#eef6ee",
          "surface-high": "#e3eae3",
          "surface-highest": "#dde4dd",
          primary: "#006c49",
          "primary-container": "#10b981",
          "on-primary": "#ffffff",
          "on-primary-container": "#00422b",
          "on-surface": "#161d19",
          "on-surface-variant": "#3c4a42",
          outline: "#6c7a71",
          "outline-variant": "#bbcabf",
          tertiary: "#a43a3a",
          "tertiary-container": "#fc7c78",
          error: "#ba1a1a",
          "error-container": "#ffdad6",
        },
      },
      borderRadius: {
        card: "10px",
        pill: "9999px",
      },
      boxShadow: {
        "hover-row": "0 1px 2px rgba(16,24,40,0.04)",
        floating: "0 8px 24px rgba(16,24,40,0.10)",
        panel: "0 4px 16px rgba(16,24,40,0.06)",
        "panel-elevated": "0 6px 20px rgba(16,24,40,0.08)",
      },
      transitionDuration: {
        fast: "120ms",
        base: "160ms",
      },
    },
  },
  plugins: [],
};

export default config;
