"use client";

import type { ReactNode } from "react";

/**
 * A dashboard block.
 *
 * Every section is REQUIRED to declare its time scope. The old dashboard put a
 * period-scoped revenue, a period-scoped event count and a live queue count in
 * identical cards with no indication they meant different things — the concrete
 * form of the design system's "counts must not lie" rule being broken. Making
 * `scope` a required prop means a new block cannot be added without answering
 * the question.
 */
export type TimeScope = "realized" | "cohort" | "now";

interface SectionProps {
  title: string;
  /** Rendered next to the title, e.g. "· 30 jours (réalisé)". */
  scopeLabel: string;
  scope: TimeScope;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Section({ title, scopeLabel, action, children, className }: SectionProps) {
  return (
    <section
      className={
        "flex flex-col gap-3 rounded-card border border-oms-border bg-oms-surface p-4 " +
        (className ?? "")
      }
    >
      <div className="flex items-baseline gap-2">
        <h2 className="m-0 text-[10.5px] font-semibold uppercase tracking-[0.075em] text-oms-ink-2">
          {title}
        </h2>
        <span className="text-[10.5px] font-normal text-oms-ink-3">{scopeLabel}</span>
        {action ? <div className="ms-auto">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function EmptyWell({ label }: { label: string }) {
  return (
    <div className="grid min-h-[120px] place-items-center rounded-lg bg-oms-sunken px-4 text-center text-[12.5px] text-oms-ink-3">
      {label}
    </div>
  );
}
