// Shared chart theme — the repo's first. Every recharts usage until now
// hardcoded its own hexes inline (six files, no two agreeing), which is how the
// unused TrendChart ended up shipping linearGradient fills against the design
// system's "no gradients" rule.
//
// Outcome colours encode meaning, not decoration: money-in is success, money-out
// is critical, refused-before-shipping is neutral-warm, and not-yet-resolved is
// deliberately the flattest tone so unresolved volume never shouts.

export const CHART_COLORS = {
  delivered: "#0E7C5A",
  returned: "#B23A32",
  rejected: "#A9670C",
  open: "#C9C5BD",
} as const;

export type OutcomeKey = keyof typeof CHART_COLORS;

/** Stacking order, bottom to top: resolved outcomes first, unresolved on top. */
export const OUTCOME_ORDER: OutcomeKey[] = ["delivered", "returned", "rejected", "open"];

export const CHART_AXIS = {
  tick: { fill: "var(--oms-ink-3)", fontSize: 10.5 },
  line: "var(--oms-border)",
} as const;

export const CHART_TOOLTIP = {
  contentStyle: {
    background: "var(--oms-surface)",
    border: "1px solid var(--oms-border)",
    borderRadius: 8,
    boxShadow: "0 8px 24px rgba(16,24,40,.10)",
    fontSize: 12,
    padding: "8px 10px",
  },
  labelStyle: { color: "var(--oms-ink-2)", fontSize: 11, marginBottom: 4 },
  itemStyle: { padding: 0, fontSize: 12 },
  // --oms-sunken is the *Tailwind alias* (`bg-oms-sunken`); the CSS var it points
  // at is --oms-surface-sunken. As written this resolved to nothing and the hover
  // cursor band rendered transparent.
  cursor: { fill: "var(--oms-surface-sunken)" },
} as const;

/**
 * Every chart on this page is behind `next/dynamic`, so it can mount before the
 * parent has laid out. ResponsiveContainer then measures 0x0, renders at zero
 * width and — having no further resize to react to — never corrects itself. The
 * OutcomeChart shipped blank for exactly this reason despite having correct data
 * and real <rect> elements in the DOM. Seeding a dimension avoids the race.
 */
export const CHART_INITIAL_DIMENSION = { width: 600, height: 220 } as const;

/** Show roughly one tick per week so a 30-day axis stays readable. */
export function axisTickInterval(pointCount: number): number {
  if (pointCount <= 10) return 0;
  return Math.max(1, Math.floor(pointCount / 5) - 1);
}

/** "12 juil." — short, locale-aware, no year (the header already states the range). */
export function formatDayTick(day: string, locale: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return new Intl.DateTimeFormat(locale === "ar" ? "ar" : "fr", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(d);
}
