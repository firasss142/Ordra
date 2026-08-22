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
        /* Entrepôt console figures. See the --wh-* block in globals.css. */
        mono: [
          "var(--font-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
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
        // Brand green — console-wide chrome. Values live in globals.css.
        // `brand` is the light-ground green (5.0:1 white-on-fill); `on-dark`
        // is #10B981, which is 2.5:1 on white and belongs to the sidebar only.
        brand: {
          DEFAULT: "var(--brand)",
          hover: "var(--brand-hover)",
          bg: "var(--brand-bg)",
          tint: "var(--brand-tint)",
          pos: "var(--brand-pos)",
          "on-dark": "var(--brand-on-dark)",
        },
        // Orders console — "soft & warm". Scoped to the orders surface;
        // see docs/design-system.md §"Orders console".
        oms: {
          bg: "var(--oms-bg)",
          surface: "var(--oms-surface)",
          sunken: "var(--oms-surface-sunken)",
          border: "var(--oms-border)",
          "border-strong": "var(--oms-border-strong)",
          "ink-1": "var(--oms-ink-1)",
          "ink-2": "var(--oms-ink-2)",
          "ink-3": "var(--oms-ink-3)",
          accent: "var(--oms-accent)",
          "accent-ink": "var(--oms-accent-ink)",
          "accent-bg": "var(--oms-accent-bg)",
          "age-warm": "var(--oms-age-warm)",
          "age-late": "var(--oms-age-late)",
          warn: "var(--oms-warn)",
          "warn-ink": "var(--oms-warn-ink)",
          "warn-bg": "var(--oms-warn-bg)",
          bad: "var(--oms-bad)",
          "bad-bg": "var(--oms-bad-bg)",
          ok: "var(--oms-ok)",
          "ok-bg": "var(--oms-ok-bg)",
          info: "var(--oms-info)",
          "info-ink": "var(--oms-info-ink)",
          "info-bg": "var(--oms-info-bg)",
        },
        // Products console — scoped extension. Aliases only; the values live in
        // globals.css. Seven tokens, because red/amber/blue reuse status.* and
        // only the grass green was genuinely missing (status.success is a teal,
        // and accent is reserved for two specific uses by the design system).
        prod: {
          brand: "var(--prod-brand)",
          "brand-hover": "var(--prod-brand-hover)",
          "brand-soft": "var(--prod-brand-soft)",
          "brand-tint": "var(--prod-brand-tint)",
          pos: "var(--prod-pos)",
          "info-bg": "var(--prod-info-bg)",
          "neutral-bg": "var(--prod-neutral-bg)",
        },
        // Finance console — scoped extension. Aliases only; values live in
        // globals.css. `green`/`teal`/`gold` are fills and glyphs; their
        // `-ink` partners are the only ones that may carry text. See the
        // contrast note in globals.css before using a raw hue on type.
        fin: {
          green: "var(--fin-green)",
          "green-ink": "var(--fin-green-ink)",
          navy: "var(--fin-navy)",
          mint: "var(--fin-mint)",
          teal: "var(--fin-teal)",
          "teal-ink": "var(--fin-teal-ink)",
          gold: "var(--fin-gold)",
          "gold-ink": "var(--fin-gold-ink)",
          bg: "var(--fin-bg)",
          line: "var(--fin-line)",
          "ink-2": "var(--fin-ink-2)",
          "ink-3": "var(--fin-ink-3)",
        },
        // Ad-spend console — scoped extension. Aliases only; the values live
        // in globals.css. Status pair (green above the floor, red below) plus
        // the six validated cost-stack hues. See the contrast note there
        // before putting type on a raw hue.
        wh: {
          bg: "var(--wh-bg)",
          surface: "var(--wh-surface)",
          "surface-2": "var(--wh-surface-2)",
          sunken: "var(--wh-sunken)",
          border: "var(--wh-border)",
          "border-strong": "var(--wh-border-strong)",
          "ink-1": "var(--wh-ink-1)",
          "ink-2": "var(--wh-ink-2)",
          "ink-3": "var(--wh-ink-3)",
          ok: "var(--wh-ok)",
          "ok-bg": "var(--wh-ok-bg)",
          "ok-edge": "var(--wh-ok-edge)",
          warn: "var(--wh-warn)",
          "warn-bg": "var(--wh-warn-bg)",
          "warn-edge": "var(--wh-warn-edge)",
          bad: "var(--wh-bad)",
          "bad-bg": "var(--wh-bad-bg)",
          "bad-edge": "var(--wh-bad-edge)",
          scan: "var(--wh-scan)",
          "scan-bg": "var(--wh-scan-bg)",
          "scan-edge": "var(--wh-scan-edge)",
          move: "var(--wh-move)",
          "move-bg": "var(--wh-move-bg)",
          "move-edge": "var(--wh-move-edge)",
          "series-1": "var(--wh-series-1)",
          "series-2": "var(--wh-series-2)",
          grid: "var(--wh-grid)",
        },
        ads: {
          line: "var(--ads-line)",
          "line-2": "var(--ads-line-2)",
          "ink-1": "var(--ads-ink-1)",
          "ink-2": "var(--ads-ink-2)",
          "ink-3": "var(--ads-ink-3)",
          muted: "var(--ads-muted)",
          green: "var(--ads-green)",
          "green-ink": "var(--ads-green-ink)",
          red: "var(--ads-red)",
          "red-ink": "var(--ads-red-ink)",
          "red-bg": "var(--ads-red-bg)",
          "red-band": "var(--ads-red-band)",
          "red-line": "var(--ads-red-line)",
          "orange-ink": "var(--ads-orange-ink)",
          "orange-bg": "var(--ads-orange-bg)",
          "orange-line": "var(--ads-orange-line)",
          pub: "var(--ads-pub)",
          cogs: "var(--ads-cogs)",
          delivery: "var(--ads-delivery)",
          returns: "var(--ads-returns)",
          packing: "var(--ads-packing)",
          profit: "var(--ads-profit)",
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
        // Agent queue. CSS-var backed (like oms.*) so globals.css is the single
        // source of truth — the literal hexes that used to live here meant a
        // palette change had to be made twice and could silently disagree.
        agent: {
          bg: "var(--agent-bg)",
          surface: "var(--agent-surface)",
          "surface-low": "var(--agent-surface-low)",
          "surface-high": "var(--agent-surface-high)",
          "surface-highest": "var(--agent-surface-highest)",
          primary: "var(--agent-primary)",
          "primary-container": "var(--agent-primary-container)",
          "on-primary": "var(--agent-on-primary)",
          "on-primary-container": "var(--agent-on-primary-container)",
          "on-surface": "var(--agent-on-surface)",
          "on-surface-variant": "var(--agent-on-surface-variant)",
          "ink-3": "var(--agent-ink-3)",
          outline: "var(--agent-outline)",
          "outline-variant": "var(--agent-outline-variant)",
          tertiary: "var(--agent-tertiary)",
          "tertiary-container": "var(--agent-tertiary-container)",
          error: "var(--agent-error)",
          "error-container": "var(--agent-error-container)",
        },
        // Status hues — phase + outcome. Shared by the agent queue's status
        // pill and its sub-filter chips; aliased to the oms.* tokens.
        // Status hues — phase + outcome. Shared by the agent queue's status
        // pill and its sub-filter chips; aliased to the oms.* tokens.
        //
        // The `-fill-soft` / `-edge-soft` / `-edge-mid` steps exist because
        // Tailwind v3 cannot apply a `/70` opacity modifier to a var()-backed
        // colour — it drops the declaration silently. Do not reintroduce
        // `bg-hue-amber-bg/70`; it compiles to nothing.
        hue: {
          "neutral-ink": "var(--hue-neutral-ink)",
          "neutral-bg": "var(--hue-neutral-bg)",
          "neutral-fill-soft": "var(--hue-neutral-fill-soft)",
          "neutral-edge": "var(--hue-neutral-edge)",
          "neutral-edge-soft": "var(--hue-neutral-edge-soft)",
          "neutral-edge-mid": "var(--hue-neutral-edge-mid)",
          "amber-ink": "var(--hue-amber-ink)",
          "amber-bg": "var(--hue-amber-bg)",
          "amber-fill-soft": "var(--hue-amber-fill-soft)",
          "amber-edge": "var(--hue-amber-edge)",
          "amber-edge-soft": "var(--hue-amber-edge-soft)",
          "amber-edge-mid": "var(--hue-amber-edge-mid)",
          "violet-ink": "var(--hue-violet-ink)",
          "violet-bg": "var(--hue-violet-bg)",
          "violet-fill-soft": "var(--hue-violet-fill-soft)",
          "violet-edge": "var(--hue-violet-edge)",
          "violet-edge-soft": "var(--hue-violet-edge-soft)",
          "violet-edge-mid": "var(--hue-violet-edge-mid)",
          "teal-ink": "var(--hue-teal-ink)",
          "teal-bg": "var(--hue-teal-bg)",
          "teal-fill-soft": "var(--hue-teal-fill-soft)",
          "teal-edge": "var(--hue-teal-edge)",
          "teal-edge-soft": "var(--hue-teal-edge-soft)",
          "teal-edge-mid": "var(--hue-teal-edge-mid)",
          "green-ink": "var(--hue-green-ink)",
          "green-bg": "var(--hue-green-bg)",
          "green-fill-soft": "var(--hue-green-fill-soft)",
          "green-edge": "var(--hue-green-edge)",
          "green-edge-soft": "var(--hue-green-edge-soft)",
          "green-edge-mid": "var(--hue-green-edge-mid)",
          "red-ink": "var(--hue-red-ink)",
          "red-bg": "var(--hue-red-bg)",
          "red-fill-soft": "var(--hue-red-fill-soft)",
          "red-edge": "var(--hue-red-edge)",
          "red-edge-soft": "var(--hue-red-edge-soft)",
          "red-edge-mid": "var(--hue-red-edge-mid)",
        },
      },
      borderRadius: {
        card: "10px",
        // Finance console only — the mockup's cards are noticeably softer
        // than the 10px the rest of the console uses.
        fin: "16px",
        wh: "12px",
        "fin-sm": "12px",
        pill: "9999px",
      },
      boxShadow: {
        "hover-row": "0 1px 2px rgba(16,24,40,0.04)",
        floating: "0 8px 24px rgba(16,24,40,0.10)",
        panel: "0 4px 16px rgba(16,24,40,0.06)",
        "panel-elevated": "0 6px 20px rgba(16,24,40,0.08)",
        // Finance console only. §1 says surfaces are flat at rest; this
        // surface lifts its cards instead of outlining them, which is what
        // the mockup does and why it needs its own shadow.
        fin: "0 1px 2px rgba(15,23,42,0.04), 0 4px 12px rgba(15,23,42,0.05)",
        "wh-glow": "var(--wh-glow)",
        "fin-hover": "0 2px 4px rgba(15,23,42,0.05), 0 8px 20px rgba(15,23,42,0.07)",
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
