import type { ReactNode } from "react";

export function TeamCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-card border border-line-subtle bg-surface-card ${className}`.trim()}>{children}</section>
  );
}

export function TeamCardHead({
  title,
  hint,
  right,
}: {
  title: ReactNode;
  hint?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line-subtle px-4 py-3.5">
      <div className="flex items-baseline gap-3">
        <h2 className="text-[16px] font-semibold text-ink-primary">{title}</h2>
        {hint && <span className="text-[12.5px] text-ink-secondary">{hint}</span>}
      </div>
      {right}
    </header>
  );
}

export function TeamPageHeader({
  title,
  subtitle,
  right,
}: {
  title: string;
  subtitle: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-[22px] font-semibold tracking-[-0.01em] text-ink-primary">{title}</h1>
        <p className="mt-1 text-[14px] text-ink-secondary">{subtitle}</p>
      </div>
      {right && <div className="flex items-center gap-2 whitespace-nowrap pt-1.5 text-[13px] text-ink-secondary">{right}</div>}
    </div>
  );
}
