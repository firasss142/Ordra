"use client";

import { useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { CalendarDays, PieChart, UserRound } from "lucide-react";
import { StatusIcon } from "@/components/shared/StatusIcon";
import { presentStatus, type StatusHue } from "@/lib/orders/status-presentation";
import type { StatusCounts } from "@/app/api/orders/status-counts/route";

/**
 * The orders KPI strip — the page's only navigation.
 *
 * It replaced two competing systems (a status chip row and a preset tab row)
 * that disagreed with each other: the chips summed to less than the stated
 * total and omitted statuses the table displayed. One system means the counts
 * can only tell one story.
 *
 * Two instruments, deliberately different shapes:
 *  · alert + health row — conditions that cut across every stage
 *  · funnel row         — the pipeline as an actual sequence
 *
 * Numbers here are computed against the whole market, never against the
 * table's active filters. A tile whose value shifted when you clicked another
 * tile would not be safe to use as navigation.
 */

export type KpiTile =
  | "unassigned"
  | "today"
  | "waiting"
  | "toRecall"
  | "confirmed"
  | "uploaded";

interface StageDef {
  key: Extract<KpiTile, "today" | "waiting" | "toRecall" | "confirmed" | "uploaded">;
  count: (c: StatusCounts) => number;
  /** Backlog ("maintenant") vs period count ("aujourd'hui") — labelled on every tile. */
  period: "now" | "today";
  /**
   * The status this tile counts. Hue and icon come from the shared presentation
   * map (§4.19), so a tile and the rows it opens cannot disagree about what
   * colour a state is. `today` has no status — it is a period, not a state — so
   * it carries a calendar in the neutral hue.
   */
  status: string | null;
}

const STAGES: StageDef[] = [
  { key: "today", count: (c) => c.today, period: "today", status: null },
  { key: "waiting", count: (c) => c.waiting, period: "now", status: "pending" },
  { key: "toRecall", count: (c) => c.toRecall, period: "now", status: "callback_scheduled" },
  // Backlog, not "confirmed today": clicking filters to status=confirmed, and a
  // tile whose number disagreed with the table it opens is the bug this replaced.
  { key: "confirmed", count: (c) => c.confirmed, period: "now", status: "confirmed" },
  { key: "uploaded", count: (c) => c.uploaded, period: "now", status: "uploaded" },
];

interface Props {
  counts?: StatusCounts;
  activeTile: KpiTile | null;
  onSelect: (tile: KpiTile | null) => void;
  isLoading?: boolean;
}

export function OrdersKpiStrip({ counts, activeTile, onSelect, isLoading }: Props) {
  const t = useTranslations("orders.kpi");
  const locale = useLocale();
  const [pipelineOpen, setPipelineOpen] = useState(true);

  const nf = useMemo(() => new Intl.NumberFormat(locale === "ar" ? "ar" : "fr-FR"), [locale]);
  const pct = (v: number) => nf.format(Math.round(v * 10) / 10) + " %";

  /** Each period gets its own denominator — a daily inflow and a standing
   *  backlog share no scale, so one bar width across both would compare
   *  quantities that are not comparable. */
  const scaleMax = useMemo(() => {
    if (!counts) return { now: 1, today: 1 };
    const max = { now: 1, today: 1 };
    for (const s of STAGES) max[s.period] = Math.max(max[s.period], s.count(counts));
    return max;
  }, [counts]);

  const toggle = (tile: KpiTile) => onSelect(activeTile === tile ? null : tile);

  if (isLoading || !counts) {
    return (
      <div className="flex flex-col gap-2.5" aria-busy="true" aria-label={t("label")}>
        {/* Sized to the real tiles, icon holder included — a skeleton that is
            shorter than what replaces it makes the page jump on every load. */}
        <div className="flex gap-2">
          <div className="h-[78px] w-[190px] rounded-card bg-oms-sunken" />
          <div className="h-[78px] w-[290px] rounded-card bg-oms-sunken" />
        </div>
        <div className="flex gap-2">
          {STAGES.map((s) => (
            <div key={s.key} className="h-[86px] flex-1 rounded-card bg-oms-sunken" />
          ))}
        </div>
      </div>
    );
  }

  const delta =
    counts.confirmationRate !== null && counts.confirmationRatePrev !== null
      ? counts.confirmationRate - counts.confirmationRatePrev
      : null;

  return (
    <section className="flex flex-col gap-2.5" aria-label={t("label")}>
      {/* ── alert + health ───────────────────────────────────────── */}
      <div className="flex flex-wrap items-stretch gap-2">
        <button
          type="button"
          aria-pressed={activeTile === "unassigned"}
          aria-label={`${t("unassigned")}: ${nf.format(counts.unassigned)} (${t("periodNow")})`}
          onClick={() => toggle("unassigned")}
          className={tileClass(activeTile === "unassigned", "min-w-[190px]")}
        >
          <span className="flex items-start gap-2.5">
            <span
              aria-hidden="true"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-hue-amber-bg text-hue-amber-ink"
            >
              <UserRound size={18} strokeWidth={2} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[24px] font-[650] leading-[1.12] tracking-[-0.022em] tabular-nums text-oms-age-warm">
                {nf.format(counts.unassigned)}
              </span>
              <span className="mt-0.5 block text-[10.5px] font-semibold uppercase tracking-[0.075em] text-oms-ink-2">
                {t("unassigned")}
              </span>
              <span className="mt-px block text-[10.5px] font-normal text-oms-ink-3">
                {t("periodNow")} · {t("unassignedHint")}
              </span>
            </span>
          </span>
        </button>

        {/* A rate has no destination to filter to, so it reads instead of
            navigating. That used to be signalled by a dashed border on a sunken
            fill, which read as disabled rather than as a readout. It is now the
            same card as its neighbours with one difference the eye picks up on
            contact: it is a <div>, and NOTHING here responds to hover. Every
            control on this row lifts under the cursor; this one does not. */}
        {counts.confirmationRate !== null && (
          <div className="flex min-w-[290px] items-center gap-3 rounded-card border border-oms-border bg-oms-surface px-3.5 py-2.5">
            <span
              aria-hidden="true"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-hue-green-bg text-hue-green-ink"
            >
              <PieChart size={18} strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-[24px] font-[650] leading-[1.12] tracking-[-0.022em] tabular-nums text-oms-ink-1">
                  {pct(counts.confirmationRate)}
                </span>
                {delta !== null && (
                  <span
                    className={
                      "inline-flex items-center gap-0.5 text-[11.5px] font-semibold tabular-nums " +
                      (delta >= 0 ? "text-brand" : "text-oms-age-late")
                    }
                  >
                    {delta >= 0 ? "▲" : "▼"} {nf.format(Math.abs(Math.round(delta * 10) / 10))}
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[10.5px] font-semibold uppercase tracking-[0.075em] text-oms-ink-2">
                {t("confirmationRate")}
              </div>
              <div className="mt-px text-[10.5px] text-oms-ink-3">{t("ratePeriod")}</div>
            </div>
          </div>
        )}

        <div className="ms-auto flex items-end pb-1">
          <span className="text-[11px] tabular-nums text-oms-ink-3">
            {t("total", { count: nf.format(counts.total) })}
          </span>
        </div>
      </div>

      {/* ── funnel ───────────────────────────────────────────────── */}
      <div className="relative">
        <div className="mb-1.5 flex items-center gap-3 text-[10.5px] font-semibold uppercase tracking-[0.075em] text-oms-ink-3">
          <span>{t("pipeline")}</span>
          <span className="inline-flex items-center gap-1.5 font-normal normal-case tracking-normal">
            <i aria-hidden className="block h-1 w-4 rounded-pill bg-brand opacity-80" />
            {t("scaleQueues")}
          </span>
          <span className="inline-flex items-center gap-1.5 font-normal normal-case tracking-normal">
            <i
              aria-hidden
              className="block h-1 w-4 rounded-pill opacity-60"
              style={{ boxShadow: "inset 0 0 0 1.5px var(--brand)" }}
            />
            {t("scaleDaily")}
          </span>
          <span className="hidden font-normal normal-case italic tracking-normal opacity-80 lg:inline">
            {t("scaleNote")}
          </span>
          <span aria-hidden className="h-px flex-1 bg-oms-border" />
          <button
            type="button"
            onClick={() => setPipelineOpen((v) => !v)}
            className="rounded-md px-1.5 py-0.5 font-normal normal-case tracking-normal text-oms-ink-3 transition-colors duration-fast hover:bg-oms-surface hover:text-oms-ink-1"
          >
            {pipelineOpen ? t("hidePipeline") : t("showPipeline")}
          </button>
        </div>

        {pipelineOpen && (
          <div className="flex flex-wrap items-stretch gap-2">
            {STAGES.map((stage) => {
              const n = stage.count(counts);
              const active = activeTile === stage.key;
              const daily = stage.period === "today";
              const width = Math.max(4, (n / scaleMax[stage.period]) * 100);
              return (
                <div key={stage.key} className="flex min-w-[118px] flex-1 basis-[128px] items-stretch">
                  <button
                    type="button"
                    aria-pressed={active}
                    // Explicit: the visible label and the period label would
                    // otherwise concatenate into an ambiguous accessible name
                    // ("Confirmées aujourd'hui" vs the "Aujourd'hui" tile).
                    aria-label={`${t(stage.key)}: ${nf.format(n)} (${daily ? t("periodToday") : t("periodNow")})`}
                    onClick={() => toggle(stage.key)}
                    className={tileClass(active, "flex-1 min-w-0 !px-3 !py-2")}
                  >
                    <span className="flex items-start gap-2.5">
                      <TileIcon status={stage.status} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[21px] font-[650] leading-[1.12] tracking-[-0.022em] tabular-nums text-oms-ink-1">
                          {nf.format(n)}
                        </span>
                        <span className="mt-0.5 block truncate text-[10.5px] font-semibold uppercase tracking-[0.075em] text-oms-ink-2">
                          {t(stage.key)}
                        </span>
                        <span className="mt-px block text-[10.5px] font-normal text-oms-ink-3">
                          {daily ? t("periodToday") : t("periodNow")}
                        </span>
                      </span>
                    </span>
                    <span className="mt-1.5 block h-1 overflow-hidden rounded-pill bg-oms-sunken">
                      <i
                        className="block h-full rounded-pill"
                        style={
                          daily
                            ? { width: `${width}%`, boxShadow: "inset 0 0 0 1.5px var(--brand)", opacity: 0.6 }
                            : { width: `${width}%`, background: "var(--brand)", opacity: 0.8 }
                        }
                      />
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * The §4.19 tinted icon holder: a 10% wash of the tile's own hue behind a 20px
 * icon in the full hue. §4.10 forbids tinted backgrounds for section identity
 * inside a panel; a tile row is a different job — it is scanned peripherally for
 * the one number you came for, and the tint is what makes it scannable before
 * a single label is read.
 */
function TileIcon({ status }: { status: string | null }) {
  const face = status ? presentStatus(status) : null;
  const hue = face?.hue ?? "neutral";
  return (
    <span
      aria-hidden="true"
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${HOLDER_BG[hue]} ${HOLDER_INK[hue]}`}
    >
      {face ? <StatusIcon name={face.icon} size={18} /> : <CalendarDays size={18} strokeWidth={2} />}
    </span>
  );
}

const HOLDER_BG: Record<StatusHue, string> = {
  neutral: "bg-hue-neutral-bg",
  amber: "bg-hue-amber-bg",
  violet: "bg-hue-violet-bg",
  teal: "bg-hue-teal-bg",
  green: "bg-hue-green-bg",
  red: "bg-hue-red-bg",
};

const HOLDER_INK: Record<StatusHue, string> = {
  neutral: "text-hue-neutral-ink",
  amber: "text-hue-amber-ink",
  violet: "text-hue-violet-ink",
  teal: "text-hue-teal-ink",
  green: "text-hue-green-ink",
  red: "text-hue-red-ink",
};

/**
 * Resting surfaces stay flat; elevation appears only on hover.
 *
 * The active state is brand green, not the violet it used to be. §4.17 C had
 * reserved violet for this tile on the argument that a tile and a tab are
 * different instruments and should not share a colour — but the console has no
 * tabs to confuse it with, and one green across the sidebar, the CTA and the
 * active tile is what makes the page read as one product. Violet stays where it
 * still means something: the `confirmed` / `callback_scheduled` status hue.
 */
function tileClass(active: boolean, extra = "") {
  return [
    "rounded-card border bg-oms-surface px-3.5 py-2.5 text-start",
    "transition-[border-color,box-shadow,background-color] duration-base",
    "hover:border-oms-border-strong hover:shadow-hover-row",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
    active
      ? "border-brand bg-brand-bg shadow-[inset_0_0_0_1px_var(--brand)]"
      : "border-oms-border",
    extra,
  ].join(" ");
}
