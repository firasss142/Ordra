import type { HTMLAttributes, ReactNode } from "react";

export type BadgeTone =
  | "neutral"
  | "action"
  | "success"
  | "warning"
  | "critical";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  dot?: boolean;
  children: ReactNode;
}

const TONES: Record<BadgeTone, { bg: string; fg: string; dot: string }> = {
  neutral: {
    bg: "bg-status-neutralBg",
    fg: "text-ink-secondary",
    dot: "bg-ink-muted",
  },
  action: {
    bg: "bg-[#EAF2FB]",
    fg: "text-status-action",
    dot: "bg-status-action",
  },
  success: {
    bg: "bg-status-successBg",
    fg: "text-status-success",
    dot: "bg-status-success",
  },
  warning: {
    bg: "bg-status-warningBg",
    fg: "text-status-warning",
    dot: "bg-status-warning",
  },
  critical: {
    bg: "bg-status-criticalBg",
    fg: "text-status-critical",
    dot: "bg-status-critical",
  },
};

export function Badge({
  tone = "neutral",
  dot = false,
  className = "",
  children,
  ...rest
}: BadgeProps) {
  const t = TONES[tone];
  const base =
    "inline-flex items-center gap-1.5 rounded-pill px-2 py-0.5 text-[12px] font-medium leading-tight";
  return (
    <span className={`${base} ${t.bg} ${t.fg} ${className}`.trim()} {...rest}>
      {dot && (
        <span
          data-badge-dot
          aria-hidden="true"
          className={`inline-block h-1.5 w-1.5 rounded-full ${t.dot}`}
        />
      )}
      <span>{children}</span>
    </span>
  );
}
