"use client";

import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import type { MarketScope } from "@/lib/markets";
import { Dot } from "./parts";

/**
 * Search, the market switch (super admin only) and « Sans activité », on the
 * list card's top edge: a white field, a segmented control (§4.11) and a chip
 * that takes the chrome green while it filters.
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
    <div className="acx-tools">
      <div className="acx-search">
        <Search size={16} aria-hidden="true" />
        <input type="search" dir="auto" value={query} onChange={(e) => onQuery(e.target.value)} placeholder={t("search")} aria-label={t("search")} autoComplete="off" />
      </div>

      {market && (
        <div role="group" aria-label={t("marketFilter")} className="acx-seg">
          {(["all", "tn", "ly"] as const).map((m) => (
            <button key={m} type="button" aria-pressed={market === m} onClick={() => onMarket(m)}>
              {t(`market.${m}`)}
              <em>{marketCounts[m]}</em>
            </button>
          ))}
        </div>
      )}

      {(dormantCount > 0 || dormantOnly) && (
        <button type="button" aria-pressed={dormantOnly} onClick={onDormant} className="acx-chip">
          <Dot tone="none" />
          {t("dormant")}
          <b>{dormantCount}</b>
        </button>
      )}

      <span aria-live="polite" className="acx-count">
        {dormantOnly ? t("countDormant", { count: resultCount }) : t("count", { count: resultCount })}
      </span>
    </div>
  );
}
