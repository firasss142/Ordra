"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ScanLine, FileClock } from "lucide-react";
import { useWarehouseSummary } from "@/hooks/useWarehouseSummary";
import { useWarehouseRealtime } from "@/hooks/useWarehouseRealtime";
import { canViewFinanceSection } from "@/lib/finance-permissions";
import { TodayOverview } from "./console/TodayOverview";
import { WH_BTN, WH_BTN_PRIMARY } from "./console/tokens";
import type { WarehouseSummary } from "@/lib/warehouse/summary";
import type { AuthUser } from "@/types";

interface Props {
  user: AuthUser;
  locale: string;
  initialSummary: WarehouseSummary;
  initialMarketId: string | "all" | null;
}

export function WarehouseOverviewClient({
  user,
  locale,
  initialSummary,
  initialMarketId,
}: Props) {
  const t = useTranslations("warehouse");
  const isSuperAdmin = canViewFinanceSection(user.role);

  const [selectedMarketId, setSelectedMarketId] = useState<string | "all">(
    isSuperAdmin ? (initialMarketId ?? "all") : (user.market_id ?? ""),
  );

  const { summary, isLoading, mutate } = useWarehouseSummary({
    marketId: isSuperAdmin ? selectedMarketId : user.market_id,
    initialSummary,
    initialMarketId,
  });

  useWarehouseRealtime({
    marketId:
      isSuperAdmin && selectedMarketId !== "all"
        ? selectedMarketId
        : isSuperAdmin
          ? null
          : user.market_id,
    page: "overview",
    onRefresh: mutate,
  });

  const current = summary ?? initialSummary;

  const marketSelector = isSuperAdmin && current.availableMarkets.length > 0 ? (
    <select
      value={selectedMarketId}
      onChange={(e) => setSelectedMarketId(e.target.value)}
      aria-label={t("overview.title")}
      className="rounded-[8px] border border-wh-border bg-wh-surface px-3 py-1.5 text-[13px] text-wh-ink-1 outline-none focus-visible:border-wh-ok"
    >
      <option value="all">{t("overview.title")}</option>
      {current.availableMarkets.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </select>
  ) : null;

  return (
    <div className="wh-console min-h-screen bg-wh-bg">
      <div className="mx-auto w-full max-w-[1440px] px-6 py-6">
        <header className="mb-5 flex flex-wrap items-start gap-4">
          <div>
            <h1 className="text-[24px] font-bold tracking-[-0.02em] text-wh-ink-1">
              {t("overview.title")}
            </h1>
            <p className="mt-[5px] text-[13px] text-wh-ink-2">
              {t("overview.subtitle")}
              {current.selectedMarket ? ` · ${current.selectedMarket.name}` : ""}
              {isLoading ? ` · ${t("overview.refreshing")}` : ""}
            </p>
          </div>
          <div className="ms-auto flex items-center gap-2.5">
            {marketSelector}
            <Link href={`/${locale}/warehouse/history`} className={WH_BTN}>
              <FileClock size={16} aria-hidden="true" />
              {t("overview.buttonJournal")}
            </Link>
            <Link href={`/${locale}/warehouse/preparation`} className={WH_BTN_PRIMARY}>
              <ScanLine size={16} strokeWidth={2} aria-hidden="true" />
              {t("overview.buttonPrepare")}
            </Link>
          </div>
        </header>

        <TodayOverview summary={current} locale={locale} />
      </div>
    </div>
  );
}
