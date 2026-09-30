"use client";

import { useTranslations } from "next-intl";
import { ChevronLeft } from "lucide-react";

export interface PanelBackBarProps {
  /** The customer's name — the screen's title once the panel covers the list. */
  name: string;
  /** Drives which way "back" points. */
  locale: string;
  onClose: () => void;
}

/**
 * The phone's way out of the panel.
 *
 * On a desktop the panel sits beside the queue and its header's × is enough:
 * the list is still there to click. Below `lg` the panel is the whole screen,
 * so it needs a title saying whose order this is and a control saying how to
 * leave — at thumb size, at the top edge, where every other full-screen view
 * in the shell puts it.
 */
export function PanelBackBar({ name, locale, onClose }: PanelBackBarProps) {
  const t = useTranslations("orders.detail");

  return (
    <div className="flex h-[52px] flex-shrink-0 items-center gap-2 border-b border-oms-border bg-oms-surface px-3 lg:hidden">
      <button
        type="button"
        onClick={onClose}
        aria-label={t("close")}
        className="grid h-11 w-11 flex-shrink-0 place-items-center rounded-[10px] text-oms-ink-1 transition-colors duration-fast hover:bg-oms-sunken"
      >
        <ChevronLeft
          size={22}
          strokeWidth={2.2}
          aria-hidden="true"
          // Back is where the reader came from, which flips with the script.
          className={locale === "ar" ? "-scale-x-100" : ""}
        />
      </button>
      <h2 className="m-0 min-w-0 flex-1 truncate text-[17px] font-bold text-oms-ink-1">
        {name}
      </h2>
    </div>
  );
}
