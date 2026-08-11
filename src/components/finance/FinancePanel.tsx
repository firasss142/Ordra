"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * A finance panel.
 *
 * The title carries a green glyph, which §4.10 forbids on a panel section
 * ("identity comes from icon + label, never a tint") — the icon is allowed
 * there, the colour is not. This surface is a scoped extension and the mockup
 * asks for the colour, so it stays; the tint does not spread to the panel
 * background, which is what §4.10 was actually protecting.
 */
export function FinancePanel({
  title,
  icon: Icon,
  action,
  children,
  className,
}: {
  title: string;
  icon?: LucideIcon;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={
        "flex flex-col gap-4 rounded-fin border border-fin-line bg-white p-5 shadow-fin " +
        (className ?? "")
      }
    >
      <div className="flex items-center gap-2.5">
        {Icon ? (
          <Icon aria-hidden size={19} strokeWidth={2} className="shrink-0 text-fin-green" />
        ) : null}
        <h2 className="m-0 text-[16.5px] font-semibold tracking-[-0.012em] text-fin-navy">
          {title}
        </h2>
        {action ? <div className="ms-auto">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function FinanceEmpty({ label }: { label: string }) {
  return (
    <div className="grid min-h-[120px] place-items-center rounded-fin-sm bg-fin-bg px-4 text-center text-[13px] text-fin-ink-3">
      {label}
    </div>
  );
}
