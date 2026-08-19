/**
 * Entrepôt console — the vocabulary every screen in this section shares.
 *
 * Values live in `--wh-*` (src/app/globals.css) and are surfaced to Tailwind
 * as `wh-*`. This file names the *meanings*, so a screen asks for "the family
 * that means a stock movement" instead of picking a colour.
 *
 * See docs/design/entrepot/entrepot-spec.md.
 */

/** The five functional families. Each carries a stroke, a tint and an edge. */
export type WhTone = "ok" | "warn" | "bad" | "scan" | "move" | "muted";

interface ToneClasses {
  /** Tinted square behind an icon: bg + border + glyph colour. */
  holder: string;
  /** Pill: bg + border + text. */
  pill: string;
  /** Bare stroke colour, for gauges and figures. */
  text: string;
  /** Gauge / bar fill. */
  fill: string;
}

export const WH_TONE: Record<WhTone, ToneClasses> = {
  ok: {
    holder: "bg-wh-ok-bg border-wh-ok-edge text-wh-ok",
    pill: "bg-wh-ok-bg border-wh-ok-edge text-wh-ok",
    text: "text-wh-ok",
    fill: "bg-wh-ok",
  },
  warn: {
    holder: "bg-wh-warn-bg border-wh-warn-edge text-wh-warn",
    pill: "bg-wh-warn-bg border-wh-warn-edge text-wh-warn",
    text: "text-wh-warn",
    fill: "bg-wh-warn",
  },
  bad: {
    holder: "bg-wh-bad-bg border-wh-bad-edge text-wh-bad",
    pill: "bg-wh-bad-bg border-wh-bad-edge text-wh-bad",
    text: "text-wh-bad",
    fill: "bg-wh-bad",
  },
  scan: {
    holder: "bg-wh-scan-bg border-wh-scan-edge text-wh-scan",
    pill: "bg-wh-scan-bg border-wh-scan-edge text-wh-scan",
    text: "text-wh-scan",
    fill: "bg-wh-scan",
  },
  move: {
    holder: "bg-wh-move-bg border-wh-move-edge text-wh-move",
    pill: "bg-wh-move-bg border-wh-move-edge text-wh-move",
    text: "text-wh-move",
    fill: "bg-wh-move",
  },
  muted: {
    holder: "bg-wh-sunken border-wh-border text-wh-ink-3",
    pill: "bg-wh-sunken border-wh-border text-wh-ink-2",
    text: "text-wh-ink-3",
    fill: "bg-wh-border-strong",
  },
};

/** Card shell. Every panel in the console starts here. */
export const WH_CARD = "rounded-wh border border-wh-border bg-wh-surface";

/** Uppercase micro-label above a figure. */
export const WH_LABEL =
  "text-[10.5px] font-semibold uppercase tracking-[0.075em] text-wh-ink-2";

/** The one glow, reserved for the primary action and the armed scan field. */
export const WH_GLOW = "shadow-wh-glow";

/**
 * Severity stripe for a row that demands action. 3px, inline-start, never
 * decorative — if every row has one, none of them mean anything.
 */
export const WH_STRIPE: Record<"bad" | "warn", string> = {
  bad: "border-s-[3px] border-s-wh-bad",
  warn: "border-s-[3px] border-s-wh-warn",
};

/** Leading-zero counter used by the returns KPIs (`0006`). */
export function padCounter(value: number, width = 4): string {
  const n = Math.max(0, Math.trunc(value));
  return String(n).padStart(width, "0");
}
