"use client";

import { useTranslations } from "next-intl";
import { LayoutGrid, List } from "lucide-react";

export type OrdersView = "board" | "table";

interface Props {
  view: OrdersView;
  onChange: (view: OrdersView) => void;
}

/** Segmented control switching the unassigned tab between the assignment board and the plain table. */
export function OrdersViewToggle({ view, onChange }: Props) {
  const t = useTranslations("orders");

  const options: { value: OrdersView; label: string; icon: typeof LayoutGrid }[] = [
    { value: "board", label: t("view.board"), icon: LayoutGrid },
    { value: "table", label: t("view.table"), icon: List },
  ];

  return (
    <div
      role="radiogroup"
      aria-label={t("view.label")}
      className="inline-flex items-center rounded-[6px] border border-line bg-surface-card p-0.5"
    >
      {options.map(({ value, label, icon: Icon }) => {
        const active = view === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(value)}
            className={
              "inline-flex items-center gap-1.5 rounded-[4px] px-2.5 py-1 text-[13px] font-medium transition-colors duration-fast " +
              (active
                ? "bg-surface-selected text-ink-primary"
                : "text-ink-muted hover:bg-surface-hover")
            }
          >
            <Icon size={14} strokeWidth={2} aria-hidden="true" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
