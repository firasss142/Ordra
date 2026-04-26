import type { ReactNode } from "react";

interface Props {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  kpiStrip?: ReactNode;
  filterBar?: ReactNode;
  children: ReactNode;
}

export function WarehouseShell({
  title,
  subtitle,
  actions,
  kpiStrip,
  filterBar,
  children,
}: Props) {
  return (
    <div className="min-h-screen bg-surface-page flex flex-col">
      <header className="px-4 sm:px-6 lg:px-8 pt-6 pb-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h1 className="m-0 text-[20px] font-semibold text-ink-primary tracking-[-0.01em]">
              {title}
            </h1>
            {subtitle ? (
              <p className="mt-1 mb-0 text-[13px] text-ink-secondary">
                {subtitle}
              </p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex items-center gap-2 shrink-0">{actions}</div>
          ) : null}
        </div>
        {kpiStrip ? <div className="mt-4">{kpiStrip}</div> : null}
      </header>

      {filterBar ? (
        <div className="border-y border-line-subtle bg-surface-card">
          <div className="px-4 sm:px-6 lg:px-8 py-2 flex items-center gap-2">{filterBar}</div>
        </div>
      ) : null}

      <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6">{children}</main>
    </div>
  );
}
