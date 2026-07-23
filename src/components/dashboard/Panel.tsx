"use client";

import type { ReactNode } from "react";

export function Panel({
  title,
  children,
  actions,
  minHeight = 280,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  minHeight?: number;
}) {
  return (
    <div
      className="bg-surface-card border border-line-subtle rounded-[8px] p-[18px] flex flex-col gap-3.5"
      style={{ minHeight }}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="m-0 text-[16px] font-semibold text-ink-primary">{title}</h2>
        {actions ?? null}
      </div>
      <div className="flex-1">{children}</div>
    </div>
  );
}

export function EmptyState({
  label,
  minHeight = 180,
}: {
  label: string;
  minHeight?: number;
}) {
  return (
    <div
      className="flex items-center justify-center rounded-[6px] bg-surface-sunken text-[13px] text-ink-secondary"
      style={{ minHeight }}
    >
      {label}
    </div>
  );
}
