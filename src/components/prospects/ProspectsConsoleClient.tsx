"use client";

/**
 * Data side of the manager console: the worklist rows it lists, and the
 * console RPC behind its KPIs, campaigns and roster. Everything visual is
 * ProspectsConsole.
 *
 * The two requests are independent, so SWR issues them together rather than
 * one after the other — the database is ~130 ms away and this page shows
 * nothing until both have landed.
 */
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { fetcher } from "@/lib/swr-config";
import { useMarketScope } from "@/context/market-scope";
import { marketIdToCode, marketTimezone } from "@/lib/markets";
import type { AgentLoadRanked, CampaignResult, ConsoleMetrics } from "@/lib/prospects/console";
import type { ProspectsResponse } from "@/lib/prospects/types";
import { ProspectsConsole } from "./ProspectsConsole";
import type { Role } from "@/types";

interface ConsoleResponse {
  metrics: ConsoleMetrics;
  campaigns: CampaignResult[];
  agents: AgentLoadRanked[];
  generated_at: string;
}

const EMPTY_METRICS: ConsoleMetrics = {
  new_7d: 0, new_prev_7d: 0, hot_waiting: 0, oldest_hot_minutes: null,
  median_first_contact_minutes: null, median_first_contact_prev: null,
  converted_30d: 0, delivered_30d: 0, delivered_revenue_30d: 0,
  pool: 0, pool_campaigns: 0, pool_oldest_days: null, never_called: 0,
  total: 0, late_callbacks: 0, lost_30d: 0, calls_today: 0, reached_today: 0,
  oldest_hot_agent: null,
};

function NoMarket() {
  const t = useTranslations("prospects");
  return (
    <div className="mx-auto w-full max-w-[1560px] px-4 py-16 text-center text-[15px] text-[#6B7280]">
      {t("selectMarket")}
    </div>
  );
}

export function ProspectsConsoleClient({
  role, marketId, locale,
}: { role: Role; marketId: string | null; locale: string }) {
  const router = useRouter();
  const scope = useMarketScope();
  const market = role === "super_admin" ? scope.marketId : marketId;

  const qs = new URLSearchParams({
    ...(role === "super_admin" && market ? { market_id: market } : {}),
    locale,
  }).toString();

  const worklistKey = market ? `/api/prospects/worklist?${qs}` : null;
  const consoleKey = market ? `/api/prospects/console${role === "super_admin" && market ? `?market_id=${market}` : ""}` : null;

  const { data: work, error: workError, mutate: mutateWork } =
    useSWR<ProspectsResponse>(worklistKey, fetcher, {
      refreshInterval: 60_000, revalidateOnFocus: true, keepPreviousData: true,
    });
  const { data: console_, error: consoleError, mutate: mutateConsole } =
    useSWR<ConsoleResponse>(consoleKey, fetcher, {
      // The KPIs are 7- and 30-day figures: they do not move minute to minute.
      refreshInterval: 300_000, revalidateOnFocus: false, keepPreviousData: true,
    });

  // Durations only; a minute's resolution is enough.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // A super_admin with scope "all" has not named a market, and the console is
  // per-market: a merged roster would imply agents work across both.
  if (!market) return <NoMarket />;

  return (
    <ProspectsConsole
      metrics={console_?.metrics ?? EMPTY_METRICS}
      campaigns={console_?.campaigns ?? []}
      agents={console_?.agents ?? []}
      rows={work?.rows ?? null}
      error={Boolean(workError || consoleError)}
      isLoading={!work && !workError}
      truncated={work?.truncated ?? false}
      onRetry={() => { void mutateWork(); void mutateConsole(); }}
      marketCode={marketIdToCode(market) ?? "tn"}
      tz={marketTimezone(market)}
      locale={locale}
      now={now}
      onNewCampaign={() => router.push(`/${locale}/leads?campaigns=1`)}
      onImportCsv={() => router.push(`/${locale}/leads?import=1`)}
      onOpenProspect={(row) => router.push(`/${locale}/leads/${row.id}`)}
    />
  );
}
