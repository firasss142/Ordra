"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import type { WarehouseSummary } from "@/lib/warehouse/summary";
import { jsonFetcher } from "@/lib/fetchers";
import { WhSpark } from "@/components/warehouse/console/WhSpark";
import { WmCard, WmTitle } from "./primitives";
import { TaskCard } from "./TaskCard";
import { SummaryStrip } from "./SummaryStrip";

/**
 * The agent's home screen (mockup 01).
 *
 * Three bands: the KPI carousel, the real bench queues as "Critical Tasks",
 * and the operator's own summary. Everything comes from two requests — the
 * summary the shell already fetches, and the operator's own stats.
 */

interface OperatorStats {
  orders_scanned_today?: number;
  scans_last_hour?: number;
  rate_per_hour?: number | null;
  hourly?: number[];
}

interface CountAccuracy {
  accuracy: number | null;
  counted_products: number;
  products: Array<{ accuracy: number | null }>;
}

interface StockRow {
  current_stock: number;
  low_stock_threshold: number;
  last_counted_at: string | null;
}

/**
 * One headline figure (mockup 01).
 *
 * Deliberately NO icon: the mockup's cards carry a plain sentence-case label
 * and nothing else above the number. The console's tinted icon holder is what
 * made these read as a different app.
 *
 * The chart is half the card and is always drawn — a card with a hole where
 * its chart should be reads as broken, which is exactly what an all-zero
 * series produced before. Zero is drawn as a flat baseline instead.
 */
function Kpi({
  id,
  label,
  value,
  unit,
  note,
  series,
}: {
  id: string;
  label: string;
  value: number;
  unit?: string;
  note: string;
  /** Omitted where no series honestly describes this figure. */
  series?: number[];
}) {
  return (
    <WmCard data-testid={`wm-kpi-${id}`} className="p-3">
      <div className="truncate text-[12.5px] text-wm-ink">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className="text-[27px] font-extrabold leading-none tabular-nums text-wm-ink">
          {value}
        </span>
        {unit ? <span className="text-[13px] font-semibold text-wm-ink">{unit}</span> : null}
      </div>
      <p className="mt-1 truncate text-[11.5px] text-wm-ink-2">{note}</p>
      <div className="mt-2 text-wm-accent">
        {series ? (
          // 38px, measured off the mockup: the chart is the card's lower half.
          <WhSpark values={series} variant="bar" height="h-[38px]" emptyBaseline />
        ) : (
          <div className="h-[38px]" aria-hidden="true" />
        )}
      </div>
    </WmCard>
  );
}

export function AgentDashboard({
  summary,
  dailyGoal,
  locale,
}: {
  summary: WarehouseSummary;
  dailyGoal: number;
  locale: string;
}) {
  const t = useTranslations("warehouse.dash");
  const tAge = useTranslations("warehouse.age");

  const { data: op } = useSWR<OperatorStats>("/api/warehouse/operator-stats", jsonFetcher, {
    refreshInterval: 60_000,
  });
  const { data: stock } = useSWR<{ rows: StockRow[] }>("/api/warehouse/stock", jsonFetcher);

  const { queue, day, trend, lowStock } = summary;

  const bars = useMemo(
    () => ({
      scanned: trend.map((p) => p.scanned),
      returned: trend.map((p) => p.returned),
      handed: trend.map((p) => p.handed),
    }),
    [trend],
  );

  /*
   * Count accuracy is per market and lives with the stock rows, so it is
   * derived here rather than fetched a third time: how many active products
   * have ever been counted, and the spread of those counts.
   */
  const counted = useMemo(() => {
    const rows = stock?.rows ?? [];
    const withCount = rows.filter((r) => r.last_counted_at !== null);
    return { total: rows.length, done: withCount.length };
  }, [stock]);

  const { data: acc } = useSWR<CountAccuracy>(
    "/api/warehouse/stock/accuracy",
    jsonFetcher,
  );

  const accuracyHistory = useMemo(
    () =>
      (acc?.products ?? [])
        .map((p) => p.accuracy)
        .filter((v): v is number => v !== null)
        .slice(0, 12)
        .reverse(),
    [acc],
  );

  return (
    <div className="px-4 py-5">
      <WmTitle>{t("title")}</WmTitle>

      {/* ── The four headline figures ──────────────────────────────── */}
      <div
        className={[
          "-mx-4 mt-4 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-4 pb-1",
          "[&>*]:min-w-[158px] [&>*]:shrink-0 [&>*]:snap-start",
          "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        ].join(" ")}
      >
        <Kpi
          id="scans"
          label={t("kpiScans")}
          value={day.scannedToday}
          note={t("kpiScansGoal", { goal: dailyGoal })}
          series={bars.scanned}
        />
        <Kpi
          id="returns"
          label={t("kpiReturns")}
          value={queue.returnsInbox}
          note={queue.returnsInbox > 0 ? t("kpiReturnsAction") : t("kpiReturnsIdle")}
          series={bars.returned}
        />
        <Kpi
          id="low"
          label={t("kpiLow")}
          value={lowStock.length}
          note={lowStock.length > 0 ? t("kpiLowSub") : t("kpiLowIdle")}
          // No sparkline: we do not record how many products were below their
          // threshold on past days, and borrowing the scan bars would put a
          // picture of scanning under a figure about stock.
        />
        <Kpi
          id="handed"
          label={t("kpiHanded")}
          value={queue.toHandOver}
          note={t("kpiHandedSub")}
          series={bars.handed}
        />
      </div>

      {/* ── The real queues, as tasks ──────────────────────────────── */}
      <h2 className="mt-6 text-[19px] font-extrabold tracking-[-0.01em] text-wm-ink">{t("tasksTitle")}</h2>
      <div className="mt-2.5 grid grid-cols-2 gap-2.5">
        <TaskCard
          href={`/${locale}/warehouse/preparation`}
          title={t("taskPrep")}
          pending={queue.toPrepare}
          done={day.scannedToday}
          foot={
            queue.toPrepare > 0
              ? t("footPrep", {
                  n: queue.toPrepare,
                  age: ageLabel(queue.oldestPrepareHours, tAge),
                })
              : null
          }
        />
        <TaskCard
          href={`/${locale}/warehouse/returns`}
          title={t("taskReturns")}
          pending={queue.returnsInbox}
          done={day.returnsToday}
          foot={
            queue.returnsInbox > 0
              ? t("footReturns", { n: queue.returnsInbox })
              : null
          }
        />
        <TaskCard
          href={`/${locale}/warehouse/stock`}
          title={t("taskCount")}
          pending={counted.total - counted.done}
          done={counted.done}
          foot={
            counted.total - counted.done > 0
              ? t("neverCounted", { n: counted.total - counted.done })
              : null
          }
        />
      </div>

      {/* ── The operator's own pace ────────────────────────────────── */}
      <h2 className="mt-6 text-[19px] font-extrabold tracking-[-0.01em] text-wm-ink">{t("summaryTitle")}</h2>
      <div className="mt-2.5">
        <SummaryStrip
          ratePerHour={op?.rate_per_hour ?? null}
          accuracy={acc?.accuracy ?? null}
          scansLastHour={op?.scans_last_hour ?? 0}
          hourly={op?.hourly ?? []}
          accuracyHistory={accuracyHistory}
          countedProducts={acc?.counted_products ?? 0}
        />
      </div>
    </div>
  );
}

/** Hours become days past two of them; nobody reads "95 j" as 2280 h. */
function ageLabel(
  hours: number,
  t: (key: "hours" | "days", values: { n: number }) => string,
): string {
  if (hours <= 0) return t("hours", { n: 0 });
  return hours >= 48
    ? t("days", { n: Math.floor(hours / 24) })
    : t("hours", { n: Math.round(hours) });
}
