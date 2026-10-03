"use client";

import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import type { MarketScope } from "@/lib/markets";
import { Dot } from "./parts";

/**
 * Search, the market switch (super admin only) and « Sans activité », in one
 * grammar: filled grey fields and a soft track with a white pill.
 */
export function AccessToolbar({
  query,
  onQuery,
  market,
  marketCounts,
  onMarket,
  dormantCount,
  dormantOnly,
  onDormant,
  resultCount,
}: {
  query: string;
  onQuery: (q: string) => void;
  /** Null for a manager: their list has one market. */
  market: MarketScope | null;
  marketCounts: Record<MarketScope, number>;
  onMarket: (m: MarketScope) => void;
  dormantCount: number;
  dormantOnly: boolean;
  onDormant: () => void;
  resultCount: number;
}) {
  const t = useTranslations("users");
  return (
    <div className="flex flex-wrap items-center gap-[10px] border-b border-[#ECEEF0] px-[16px] py-[14px] ps-[20px]">
      <div className="relative min-w-[200px] flex-[1_1_240px] md:max-w-[360px]">
        <Search size={16} aria-hidden="true" className="pointer-events-none absolute start-[12px] top-[11px] text-[#656B72]" />
        <input
          type="search"
          dir="auto"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder={t("search")}
          aria-label={t("search")}
          autoComplete="off"
          className="h-[38px] w-full rounded-[10px] border border-transparent bg-[#F3F4F6] pe-[12px] ps-[36px] text-[14px] text-[#15171A] transition-colors placeholder:text-[#656B72] hover:bg-[#EDEEF1] focus:border-brand focus:bg-white focus:shadow-[0_0_0_3px_var(--brand-bg)] focus:outline-none"
        />
      </div>

      {market && (
        <div role="group" aria-label={t("marketFilter")} className="inline-flex gap-[2px] rounded-[10px] bg-[#F3F4F6] p-[3px]">
          {(["all", "tn", "ly"] as const).map((m) => {
            const on = market === m;
            return (
              <button
                key={m}
                type="button"
                aria-pressed={on}
                onClick={() => onMarket(m)}
                className={`inline-flex h-[32px] items-center gap-[6px] rounded-[8px] px-[12px] text-[13px] transition-colors ${
                  on ? "bg-white font-semibold text-[#15171A] shadow-[0_1px_2px_rgba(16,24,40,.08),0_0_0_1px_rgba(16,24,40,.04)]" : "font-medium text-[#4F555B] hover:text-[#15171A]"
                }`}
              >
                {t(`market.${m}`)}
                <span className="text-[11.5px] font-medium text-[#656B72] tabular-nums">{marketCounts[m]}</span>
              </button>
            );
          })}
        </div>
      )}

      {(dormantCount > 0 || dormantOnly) && (
        <button
          type="button"
          aria-pressed={dormantOnly}
          onClick={onDormant}
          className={`inline-flex h-[38px] items-center gap-[7px] rounded-[10px] border px-[13px] text-[13px] transition-colors ${
            dormantOnly ? "border-[#A9DDBC] bg-brand-bg font-semibold text-brand-hover" : "border-transparent bg-[#F3F4F6] font-medium text-[#4F555B] hover:bg-[#EDEEF1] hover:text-[#15171A]"
          }`}
        >
          <Dot tone="none" />
          {t("dormant")}
          <span className="font-semibold tabular-nums">{dormantCount}</span>
        </button>
      )}

      <span aria-live="polite" className="ms-auto whitespace-nowrap text-[12.5px] text-[#656B72]">
        {dormantOnly ? t("countDormant", { count: resultCount }) : t("count", { count: resultCount })}
      </span>
    </div>
  );
}
