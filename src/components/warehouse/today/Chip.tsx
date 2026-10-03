/**
 * The prototype's `.chip` — a pill with a 6px dot, in a status tone.
 *
 * `warn` text is the warning's -ink partner (#7A5B00): the amber itself only
 * reaches 3.4:1 on its own tint, the §4.21 rule the prototype follows. `info`
 * is Ordra's action blue, the one place the warehouse uses it.
 */
export type ChipTone = "warn" | "bad" | "ok" | "info" | "mute";

const TONE: Record<ChipTone, { chip: string; dot: string }> = {
  warn: { chip: "bg-status-warningBg text-[#7A5B00]", dot: "bg-status-warning" },
  bad: { chip: "bg-status-criticalBg text-status-critical", dot: "bg-status-critical" },
  ok: { chip: "bg-status-successBg text-status-success", dot: "bg-status-success" },
  info: { chip: "bg-[#EEF4FC] text-status-action", dot: "bg-status-action" },
  mute: { chip: "bg-wm-track text-ink-secondary", dot: "bg-ink-muted" },
};

export function Chip({
  tone,
  children,
  dot = true,
  className = "",
  testId,
}: {
  tone: ChipTone;
  children: React.ReactNode;
  /** The desk's count chip (« À décider · 4 ») carries no dot. */
  dot?: boolean;
  /** Padding differs: 3px 9px on the phone, 2px 9px on the desk. */
  className?: string;
  testId?: string;
}) {
  const t = TONE[tone];
  return (
    <span
      data-testid={testId}
      data-tone={tone}
      className={`inline-flex items-center gap-[6px] whitespace-nowrap rounded-pill px-[9px] text-[12px] font-semibold ${t.chip} ${className || "py-[3px]"}`}
    >
      {dot ? <i aria-hidden="true" className={`h-[6px] w-[6px] shrink-0 rounded-full ${t.dot}`} /> : null}
      {children}
    </span>
  );
}
