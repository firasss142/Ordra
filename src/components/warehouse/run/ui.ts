/**
 * The phone's building blocks, as the v3 prototype draws them
 * (prototypes/entrepot-day-loop-agent-v3.html, `.btn`, `.card`, `.chip`, …).
 *
 * Every size is in px on purpose: the console's root font is 14px, so a `p-4`
 * or `rounded-lg` lands 12.5% smaller than the prototype it was copied from.
 * Shared by the run (Sortir's scan run) and the bench (Sortir, the lookup sheet).
 */

/** IBM Plex Mono, as in the prototype's `.mono`. `.wh-mobile .font-mono` is
 *  re-pointed to the sans, so the family is named directly. */
export const MONO = "[font-family:var(--font-mono),ui-monospace,Menlo,monospace] tabular-nums";

export const CARD = "rounded-[16px] border border-line-subtle bg-white";

const BTN =
  "inline-flex min-h-[48px] items-center justify-center gap-[8px] whitespace-nowrap rounded-[12px] px-[18px] text-[15px] font-bold disabled:opacity-40";
export const BTN_PRI = `${BTN} bg-brand text-white active:bg-brand-hover`;
export const BTN_SEC = `${BTN} border border-[var(--border-strong)] bg-white text-wm-ink`;
export const BTN_GHOST = `${BTN} font-semibold text-wm-ink-2`;
export const BTN_DANGER = `${BTN} border-[1.5px] border-wh-bad bg-white text-wh-bad`;
/** `.btn.xl` */
export const XL = "min-h-[64px] rounded-[16px] text-[16px]";

/** `.label` — uppercase in French, plain in Arabic. */
export const LABEL =
  "text-[11.5px] font-semibold uppercase tracking-[.05em] text-wm-ink-2 rtl:text-[12.5px] rtl:normal-case rtl:tracking-normal";

export const CHIP =
  "inline-flex items-center gap-[6px] whitespace-nowrap rounded-pill px-[9px] py-[3px] text-[12px] font-semibold";

/** Darb's two rolls that read as blank on white: they take an edge, and dark text on a band. */
const LIGHT_ROLLS = new Set(["#f9fc01", "#8fff00"]);
export function isLightRoll(hex: string | null | undefined): boolean {
  return !!hex && LIGHT_ROLLS.has(hex.toLowerCase());
}
