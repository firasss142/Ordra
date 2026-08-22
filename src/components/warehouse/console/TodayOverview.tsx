"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import {
  PackageSearch, ScanLine, Truck, RotateCcw, Layers,
  AlertTriangle, Clock, Upload, Warehouse, Check, Info,
} from "lucide-react";
import type { WarehouseSummary, WarehouseLeaderRow } from "@/lib/warehouse/summary";
import { WhActionRow, WhCard, WhChip, WhPipeline, type WhPipelineCellDef } from "./primitives";
import { WH_LABEL, WH_TONE } from "./tokens";

const WarehouseTrendChart = dynamic(
  () => import("../WarehouseTrendChart").then((m) => m.WarehouseTrendChart),
  { ssr: false, loading: () => <div className="h-[240px] rounded-[10px] bg-wh-sunken" /> },
);

/**
 * Aujourd'hui — "what must the warehouse do now, and are we late?"
 *
 * Follows docs/design/entrepot/entrepot-light.html §Aujourd'hui: a five-cell
 * pipeline, four priority actions, the 14-day activity curve, the team
 * ranking, and today against yesterday.
 *
 * Every figure is real. Where production has none yet — no order has ever been
 * scanned through the OMS, so the day figures read 0 — the empty state is
 * drawn rather than the panel hidden: an operator needs to see that the bench
 * has produced nothing today, not to be shown a card that quietly vanished.
 */

/** Scans per hour a full-time operator is expected to hold. */
const RATE_GOAL = 3;

/** A namespaced translator, narrowed to the values next-intl accepts. */
type TFn = (key: string, params?: Record<string, string | number>) => string;

/** French decimals: 4.8 reads as 4,8. */
function dec(n: number, digits = 1): string {
  return n.toFixed(digits).replace(".", ",");
}

/** Hours on the bench, said the way a person would say it. */
function ageLabel(hours: number, t: TFn): string {
  if (hours < 24) return t("hours", { count: Math.round(hours) });
  return t("days", { count: Math.floor(hours / 24) });
}

type Direction = "up" | "down" | "flat";

function compare(current: number, previous: number): { dir: Direction; pct: number | null } {
  if (previous === 0) return { dir: current > 0 ? "up" : "flat", pct: null };
  const pct = Math.round(((current - previous) / previous) * 100);
  return { dir: pct > 0 ? "up" : pct < 0 ? "down" : "flat", pct: Math.abs(pct) };
}

/* ── One "today vs yesterday" cell ────────────────────────────────────── */

function VsCell({
  id, label, current, previous, riseIsGood, noBaseline,
}: {
  id: string;
  label: string;
  current: number;
  previous: number;
  /** A rise in returns processed is good; a rise in returns waiting is not. */
  riseIsGood: boolean;
  noBaseline: string;
}) {
  const { dir, pct } = compare(current, previous);
  const good = dir === "flat" ? null : (dir === "up") === riseIsGood;
  const tone = good === null ? "text-wh-ink-3" : good ? "text-wh-ok" : "text-wh-bad";

  return (
    <div data-testid={`wh-vs-${id}`} data-direction={dir} className="px-[18px] py-[15px]">
      <div className="text-[12px] text-wh-ink-2">{label}</div>
      <div className="mt-[5px] font-mono text-[23px] font-bold tabular-nums text-wh-ink-1">
        {current}
      </div>
      <span className={`mt-1 inline-flex items-center gap-1 text-[12px] font-semibold ${tone}`}>
        {pct === null ? (
          // Yesterday was zero: a percentage would be a division by nothing.
          <span className="text-wh-ink-3">— {noBaseline}</span>
        ) : (
          <>
            {dir === "up" ? "▲" : dir === "down" ? "▼" : "—"} {pct} %
          </>
        )}
      </span>
    </div>
  );
}

/* ── One row of the ranking ───────────────────────────────────────────── */

const AVATAR_TONE = ["ok", "scan", "move", "warn", "bad"] as const;

function RankRow({
  row, index, above, fastest, t,
}: {
  row: WarehouseLeaderRow;
  index: number;
  above: WarehouseLeaderRow | null;
  fastest: number;
  t: TFn;
}) {
  const tone = AVATAR_TONE[index % AVATAR_TONE.length];
  const initials = row.name.slice(0, 2).toUpperCase();
  const share = fastest > 0 ? Math.min((row.ratePerHour / fastest) * 100, 100) : 0;
  const goalTick = fastest > 0 ? Math.min((RATE_GOAL / fastest) * 100, 100) : 0;

  return (
    <div data-testid={`wh-rank-${row.actorId}`} className="flex items-center gap-3.5 px-[18px] py-[15px]">
      <span className="w-3.5 font-mono text-[15px] font-bold text-wh-ink-3">{index + 1}</span>
      <span
        className={`grid h-[38px] w-[38px] shrink-0 place-items-center rounded-pill text-[12px] font-bold ${WH_TONE[tone].fill} text-white`}
      >
        {initials}
      </span>
      <div className="min-w-0 flex-1">
        <b className="text-[14px] font-semibold text-wh-ink-1">{row.name}</b>
        <span className="mt-0.5 block text-[12px] text-wh-ink-2">
          {t("rankingRow", { scanned: row.scanned, hours: dec(row.activeHours) })}
        </span>
        <div className="relative mt-[7px] h-2 rounded-pill bg-wh-sunken">
          <i
            className={`absolute inset-y-0 start-0 rounded-pill ${WH_TONE[tone].fill}`}
            style={{ width: `${share}%` }}
            aria-hidden="true"
          />
          {/* Where the objective sits on this scale. */}
          <span
            className="absolute -top-[3px] -bottom-[3px] w-[2.5px] rounded-[2px] bg-wh-ink-1"
            style={{ insetInlineStart: `${goalTick}%` }}
            aria-hidden="true"
          />
        </div>
      </div>
      <div className="w-[150px] shrink-0">
        <div className="text-end font-mono text-[19px] font-bold tabular-nums text-wh-ink-1">
          {dec(row.ratePerHour)} <span className="text-[11.5px] text-wh-ink-3">{t("perHour")}</span>
        </div>
        {above ? (
          <div data-testid="wh-gap" className="mt-[5px] text-end font-mono text-[11.5px] text-wh-ink-3">
            {t("rankingGap", {
              delta: `−${dec(above.ratePerHour - row.ratePerHour)}`,
              name: above.name,
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ── The screen ───────────────────────────────────────────────────────── */

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
  const { queue, day, leaderboard, lowStock, trend } = summary;

  const cells: WhPipelineCellDef[] = useMemo(() => {
    /*
     * The five bars share ONE denominator: everything on the floor today. A
     * bar therefore means "this queue's share of the work", and the bars are
     * comparable to each other. They used to use per-cell fudges
     * (`min(count * 4, 100)`), which drew a full bar for 25 orders and a full
     * bar for 400 — a shape that looks like data and carries none.
     */
    const floor = Math.max(
      queue.toPrepare + day.scannedToday + day.handedToday + queue.returnsInbox,
      1,
    );
    const share = (n: number) => Math.round((n / floor) * 100);
    const scanCmp = compare(day.scannedToday, day.scannedYesterday);

    return [
      {
        id: "prepare",
        label: t("overview.cellPrepare"),
        value: queue.toPrepare,
        tone: queue.toPrepare > 0 ? "warn" : "muted",
        icon: PackageSearch,
        dim: queue.toPrepare === 0,
        barPct: share(queue.toPrepare),
        chip:
          queue.toPrepare > 0 && queue.oldestPrepareHours > 0 ? (
            <WhChip tone="warn">
              {t("overview.oldestChip", { age: ageLabel(queue.oldestPrepareHours, (k, p) => t(`overview.${k}`, p)) })}
            </WhChip>
          ) : undefined,
      },
      {
        id: "scanned",
        label: t("overview.cellScanned"),
        value: day.scannedToday,
        tone: "scan",
        icon: ScanLine,
        dim: day.scannedToday === 0,
        barPct: share(day.scannedToday),
        chip:
          scanCmp.pct !== null ? (
            <WhChip tone={scanCmp.dir === "down" ? "bad" : "ok"}>
              {t("overview.vsGoalChip", {
                delta: `${scanCmp.dir === "down" ? "−" : "+"}${scanCmp.pct} %`,
              })}
            </WhChip>
          ) : undefined,
      },
      {
        id: "handed",
        label: t("overview.cellHanded"),
        value: day.handedToday,
        tone: "ok",
        icon: Truck,
        dim: day.handedToday === 0,
        barPct: share(day.handedToday),
      },
      {
        id: "returns",
        label: t("overview.cellReturns"),
        value: queue.returnsInbox,
        tone: queue.returnsInbox > 0 ? "move" : "muted",
        icon: RotateCcw,
        dim: queue.returnsInbox === 0,
        barPct: share(queue.returnsInbox),
      },
      {
        id: "lowStock",
        label: t("overview.cellLowStock"),
        value: lowStock.length,
        tone: lowStock.length > 0 ? "bad" : "muted",
        icon: Layers,
        dim: lowStock.length === 0,
        chip:
          lowStock.length === 0 ? (
            <WhChip tone="muted" icon={Check}>
              {t("overview.noneChip")}
            </WhChip>
          ) : undefined,
      },
    ];
  }, [queue, day, lowStock.length, t]);

  /*
   * The four rows the prototype names, ordered by size — the biggest arrears
   * first, so the stripe on row one always marks the real problem.
   */
  const actions = useMemo(() => {
    const rows = [
      {
        id: "neverScanned",
        icon: AlertTriangle,
        tone: "bad" as const,
        title: t("overview.actNeverScanned"),
        detail: t("overview.actNeverScannedDetail"),
        value: queue.neverScanned,
        unit: t("overview.unitOrders"),
        onClick: onOpenPreparation,
      },
      {
        id: "carrierWarehouse",
        icon: Warehouse,
        tone: "scan" as const,
        title: t("overview.actCarrierWarehouse"),
        detail: t("overview.actCarrierWarehouseDetail"),
        value: queue.carrierWarehouse,
        unit: t("overview.unitOrders"),
      },
      {
        id: "confirmed",
        icon: Upload,
        tone: "ok" as const,
        title: t("overview.actConfirmed"),
        detail: t("overview.actConfirmedDetail"),
        value: queue.confirmedNotUploaded,
        unit: t("overview.unitOrders"),
      },
      {
        id: "late",
        icon: Clock,
        tone: "warn" as const,
        title: t("overview.actLate"),
        detail: t("overview.actLateDetail", {
          age: ageLabel(queue.oldestPrepareHours, (k, p) => t(`overview.${k}`, p)),
        }),
        value: queue.latePrepare,
        unit: t("overview.unitParcels"),
        onClick: onOpenPreparation,
      },
      ...lowStock.map((p) => ({
        id: `low-${p.id}`,
        icon: Layers,
        tone: "bad" as const,
        title: t("overview.actionLowStock", { product: p.name }),
        detail: t("overview.actionLowStockDetail", {
          stock: p.current_stock,
          threshold: p.low_stock_threshold,
        }),
        value: Math.max(p.low_stock_threshold - p.current_stock, 0),
        unit: t("overview.unitUnits"),
        onClick: undefined as (() => void) | undefined,
      })),
    ].filter((r) => r.value > 0);

    rows.sort((a, b) => b.value - a.value);
    return rows;
  }, [queue, lowStock, t, onOpenPreparation]);

  const total = actions.reduce((n, a) => n + a.value, 0);
  const fastest = leaderboard.length > 0 ? leaderboard[0].ratePerHour : 0;

  return (
    <div className="flex flex-col gap-[18px]">
      <WhPipeline cells={cells} />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <WhCard
            title={t("overview.priorityActions")}
            actions={
              <span className="flex items-baseline gap-2">
                <span className={WH_LABEL}>{t("overview.totalToCatchUp")}</span>
                <b data-testid="wh-actions-total" className="font-mono text-[17px] font-bold tabular-nums text-wh-ink-1">
                  {total}
                </b>
              </span>
            }
          >
            {actions.length === 0 ? (
              <p data-testid="wh-actions-empty" className="px-4 py-8 text-center text-[13px] text-wh-ink-3">
                {t("overview.priorityActionsEmpty")}
              </p>
            ) : (
              <div className="divide-y divide-wh-border">
                {actions.map((a, i) => (
                  <WhActionRow
                    key={a.id}
                    id={a.id}
                    icon={a.icon}
                    tone={a.tone}
                    title={a.title}
                    detail={a.detail}
                    value={a.value}
                    unit={a.unit}
                    stripe={i === 0}
                    onClick={a.onClick}
                  />
                ))}
              </div>
            )}
          </WhCard>

          <WhCard title={t("overview.activity")} hint={t("overview.activityRange")}>
            <div className="flex gap-4 px-[18px] pt-3 text-[12px] text-wh-ink-2">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-[3px] bg-wh-ok" />
                {t("overview.seriesScanned")}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-[3px] bg-wh-scan" />
                {t("overview.seriesReturns")}
              </span>
            </div>
            <div className="px-[18px] pb-4 pt-2.5">
              <WarehouseTrendChart
                data={trend}
                colorScheme="light"
                series={["scanned", "returned"]}
                showLegend={false}
                labels={{
                  scanned: t("overview.seriesScanned"),
                  returned: t("overview.seriesReturns"),
                  damaged: t("overview.trendDamaged"),
                }}
              />
            </div>
          </WhCard>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <WhCard
            title={t("overview.ranking")}
            hint={
              <span title={t("overview.rankingHint")} className="inline-flex">
                <Info size={13} aria-hidden="true" />
              </span>
            }
            footer={
              leaderboard.length > 0 ? (
                <span className="flex items-center gap-2 text-wh-ink-2">
                  <span className="inline-block h-3.5 w-[2.5px] rounded-[2px] bg-wh-ink-1" />
                  {t("overview.rankingGoal")}{" "}
                  <b className="font-mono tabular-nums">
                    {dec(RATE_GOAL)} {t("overview.perHour")}
                  </b>
                </span>
              ) : undefined
            }
          >
            {leaderboard.length === 0 ? (
              <p data-testid="wh-ranking-empty" className="px-4 py-8 text-center text-[13px] text-wh-ink-3">
                {t("overview.rankingEmpty")}
              </p>
            ) : (
              <div className="divide-y divide-wh-border">
                {leaderboard.map((row, i) => (
                  <RankRow
                    key={row.actorId}
                    row={row}
                    index={i}
                    above={i === 0 ? null : leaderboard[i - 1]}
                    fastest={fastest}
                    t={(k, p) => t(`overview.${k}`, p)}
                  />
                ))}
              </div>
            )}
          </WhCard>

          <WhCard title={t("overview.vsYesterday")}>
            <div className="grid grid-cols-3 divide-x divide-wh-border">
              <VsCell
                id="scanned"
                label={t("overview.vsScanned")}
                current={day.scannedToday}
                previous={day.scannedYesterday}
                riseIsGood
                noBaseline={t("overview.vsNoBaseline")}
              />
              <VsCell
                id="returns"
                label={t("overview.vsReturns")}
                current={day.returnsToday}
                previous={day.returnsYesterday}
                riseIsGood
                noBaseline={t("overview.vsNoBaseline")}
              />
              <VsCell
                id="handed"
                label={t("overview.vsHanded")}
                current={day.handedToday}
                previous={day.handedYesterday}
                riseIsGood
                noBaseline={t("overview.vsNoBaseline")}
              />
            </div>
          </WhCard>
        </div>
      </div>
    </div>
  );
}
