import type { BadgeTone } from "@/lib/navigation/sidebar-nav";

const TONE_VARS: Record<BadgeTone, { bg: string; fg: string }> = {
  warning: { bg: "var(--badge-warning-bg)", fg: "var(--badge-warning-fg)" },
  success: { bg: "var(--badge-success-bg)", fg: "var(--badge-success-fg)" },
  critical: { bg: "var(--badge-critical-bg)", fg: "var(--badge-critical-fg)" },
};

export function formatNavCount(count: number): string {
  return count > 999 ? "999+" : String(count);
}

/**
 * The one count chip of the dark sidebar — links, folded groups, the alerts
 * button and the market list all use it. The digits are isolated left-to-right:
 * inheriting an Arabic page's direction turned « 99+ » into « +99 ».
 */
export function NavBadge({ count, tone, label }: { count: number; tone: BadgeTone; label?: string }) {
  if (!(count > 0)) return null;
  const { bg, fg } = TONE_VARS[tone];
  return (
    <span
      className="sb-badge"
      style={{ backgroundColor: bg, color: fg, direction: "ltr", unicodeBidi: "isolate" }}
    >
      {formatNavCount(count)}
      {label ? <span className="sr-only"> {label}</span> : null}
    </span>
  );
}
