"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import {
  PackageSearch,
  ScanLine,
  RotateCcw,
  AlertTriangle,
  Layers,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import type { WarehouseSummary } from "@/lib/warehouse/summary";
import { WhActionRow, WhCard, WhKpiStrip, WhPill, type WhKpiCellDef } from "./primitives";
import { WH_LABEL } from "./tokens";

const WarehouseTrendChart = dynamic(
  () => import("../WarehouseTrendChart").then((m) => m.WarehouseTrendChart),
  { ssr: false, loading: () => <div className="h-[240px] rounded-[10px] bg-wh-sunken" /> },
);

/**
 * Aujourd'hui — the operational answer to "what must the warehouse do now?".
 *
 * Every figure here comes from `/api/warehouse/summary`; nothing is invented.
 * Two things the mock-up shows are deliberately absent because no data source
 * backs them yet, and a plausible-looking number is worse than none:
 *   · "Remis aujourd'hui" — handovers are not aggregated anywhere.
 *   · "Classement" — /api/warehouse/operator-stats is scoped to the CURRENT
 *     user, so it cannot rank a team.
 * Both are listed in docs/design/entrepot/entrepot-spec.md §5.
 */

type KpiKey = "pendingLabels" | "toScanOut" | "returnsInbox" | "damagedThisWeek";

function direction(delta: number): "up" | "down" | "flat" {
  if (delta > 0) return "up";
  if (delta < 0) return "down";
  return "flat";
}

function DeltaBadge({
  id,
  delta,
  deltaPct,
  /** Whether a rise is good news. A rise in returns is not. */
  riseIsGood,
}: {
  id: KpiKey;
  delta: number;
  deltaPct: number | null;
  riseIsGood: boolean;
}) {
  const dir = direction(delta);
  const Icon = dir === "up" ? TrendingUp : dir === "down" ? TrendingDown : Minus;
  const good = dir === "flat" ? null : (dir === "up") === riseIsGood;
  const tone = good === null ? "text-wh-ink-3" : good ? "text-wh-ok" : "text-wh-bad";
  const pct = deltaPct === null ? null : Math.round(Math.abs(deltaPct));

  return (
    <span
      data-testid={`wh-delta-${id}`}
      data-direction={dir}
      className={`inline-flex items-center gap-1 text-[12px] font-semibold tabular-nums ${tone}`}
    >
      <Icon size={13} aria-hidden="true" />
      {pct === null ? Math.abs(delta) : `${pct} %`}
    </span>
  );
}

export function TodayOverview({
  summary,
  locale,
  onOpenPreparation,
  onOpenReturns,
}: {
  summary: WarehouseSummary;
  locale: string;
  onOpenPreparation?: () => void;
  onOpenReturns?: () => void;
}) {
  const t = useTranslations("warehouse");
  const { kpis, lowStock, trend } = summary;

  const cells: WhKpiCellDef[] = useMemo(() => {
    const scanTarget = Math.max(kpis.toScanOut.current + kpis.toScanOut.previous, 1);
    return [
      {
        id: "pendingLabels",
        label: t("overview.pendingLabels"),
        value: kpis.pendingLabels.current,
        tone: kpis.pendingLabels.current > 0 ? "warn" : "muted",
        icon: PackageSearch,
        gaugePct: Math.min(kpis.pendingLabels.current * 4, 100),
        settled: kpis.pendingLabels.current === 0,
      },
      {
        id: "toScanOut",
        label: t("overview.toScanOut"),
        value: kpis.toScanOut.current,
        tone: "scan",
        icon: ScanLine,
        gaugePct: Math.round((kpis.toScanOut.current / scanTarget) * 100),
        settled: kpis.toScanOut.current === 0,
      },
      {
        id: "returnsInbox",
        label: t("overview.returnsInbox"),
        value: kpis.returnsInbox.current,
        tone: kpis.returnsInbox.current > 0 ? "move" : "muted",
        icon: RotateCcw,
        gaugePct: Math.min(kpis.returnsInbox.current * 8, 100),
        settled: kpis.returnsInbox.current === 0,
      },
      {
        id: "damagedThisWeek",
        label: t("overview.damagedWeek"),
        value: kpis.damagedThisWeek.current,
        tone: kpis.damagedThisWeek.current > 0 ? "bad" : "muted",
        icon: AlertTriangle,
        gaugePct: Math.min(kpis.damagedThisWeek.current * 10, 100),
        settled: kpis.damagedThisWeek.current === 0,
      },
      {
        id: "lowStock",
        label: t("overview.lowStockTitle"),
        value: lowStock.length,
        tone: lowStock.length > 0 ? "bad" : "muted",
        icon: Layers,
        settled: lowStock.length === 0,
      },
    ];
  }, [kpis, lowStock.length, t]);

  const actions = useMemo(() => {
    const out: Array<{
      key: string;
      icon: typeof PackageSearch;
      tone: "bad" | "warn" | "move" | "scan";
      title: string;
      detail: string;
      value: number;
      unit: string;
      stripe?: "bad" | "warn";
      onClick?: () => void;
    }> = [];

    if (kpis.pendingLabels.current > 0) {
      out.push({
        key: "prepare",
        icon: PackageSearch,
        tone: "warn",
        title: t("overview.pendingLabels"),
        detail: t("overview.goToPreparation"),
        value: kpis.pendingLabels.current,
        unit: "cmdes",
        stripe: kpis.pendingLabels.current > 20 ? "warn" : undefined,
        onClick: onOpenPreparation,
      });
    }
    if (kpis.returnsInbox.current > 0) {
      out.push({
        key: "returns",
        icon: RotateCcw,
        tone: "move",
        title: t("overview.returnsInbox"),
        detail: t("overview.goToReturns"),
        value: kpis.returnsInbox.current,
        unit: "colis",
        onClick: onOpenReturns,
      });
    }
    for (const p of lowStock) {
      out.push({
        key: `low-${p.id}`,
        icon: Layers,
        tone: "bad",
        title: p.name,
        detail: `${p.current_stock} / ${p.low_stock_threshold} u`,
        value: Math.max(p.low_stock_threshold - p.current_stock, 0),
        unit: "u",
        stripe: "bad",
      });
    }
    return out;
  }, [kpis, lowStock, t, onOpenPreparation, onOpenReturns]);

  const comparisons: Array<{ key: KpiKey; label: string; riseIsGood: boolean }> = [
    { key: "pendingLabels", label: t("overview.pendingLabels"), riseIsGood: false },
    { key: "toScanOut", label: t("overview.toScanOut"), riseIsGood: true },
    { key: "returnsInbox", label: t("overview.returnsInbox"), riseIsGood: false },
  ];

  return (
    <div className="flex flex-col gap-4">
      <WhKpiStrip cells={cells} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.85fr)]">
        <div className="flex flex-col gap-4">
          <WhCard
            title={t("overview.recentScans")}
            actions={
              <span className={WH_LABEL}>
                {actions.length}
              </span>
            }
          >
            {actions.length === 0 ? (
              <p data-testid="wh-actions-empty" className="px-4 py-8 text-center text-[13px] text-wh-ink-3">
                {t("overview.lowStockEmpty")}
              </p>
            ) : (
              <div className="divide-y divide-wh-border">
                {actions.map((a) => (
                  <WhActionRow
                    key={a.key}
                    icon={a.icon}
                    tone={a.tone}
                    title={a.title}
                    detail={a.detail}
                    value={a.value}
                    unit={a.unit}
                    stripe={a.stripe}
                    onClick={a.onClick}
                  />
                ))}
              </div>
            )}
          </WhCard>

          <WhCard title={t("overview.trendTitle")}>
            <div className="p-4">
              <WarehouseTrendChart
                data={trend}
                colorScheme="dark"
                labels={{
                  scanned: t("overview.trendScanned"),
                  returned: t("overview.trendReturned"),
                  damaged: t("overview.trendDamaged"),
                }}
              />
            </div>
          </WhCard>
        </div>

        <WhCard title={t("overview.vsLastWeek")}>
          <div className="divide-y divide-wh-border">
            {comparisons.map((c) => {
              const k = kpis[c.key];
              return (
                <div key={c.key} className="flex items-baseline gap-3 px-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className={WH_LABEL}>{c.label}</div>
                    <div className="mt-1 text-[22px] font-semibold leading-none tabular-nums text-wh-ink-1">
                      {k.current}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <DeltaBadge id={c.key} delta={k.delta} deltaPct={k.deltaPct} riseIsGood={c.riseIsGood} />
                    <WhPill tone="muted">{k.previous}</WhPill>
                  </div>
                </div>
              );
            })}
          </div>
        </WhCard>
      </div>
    </div>
  );
}
