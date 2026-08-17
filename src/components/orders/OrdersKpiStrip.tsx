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
  | "periodTotal"
  | "uploaded"
  | "rejected"
  | "delivered"
  | "toRecall";

interface StageDef {
  key: Extract<KpiTile, "periodTotal" | "uploaded" | "rejected" | "delivered" | "toRecall">;
  count: (c: StatusCounts) => number;
  /**
   * `window` — counted over the active date range (today by default), and it
   * moves when the range does. `now` — a standing backlog with no date at all.
   * Labelled on every tile, because a period tally and a backlog are not the
   * same kind of number.
   */
  period: "now" | "window";
  /**
   * The status this tile counts. Hue and icon come from the shared presentation
   * map (§4.19), so a tile and the rows it opens cannot disagree about what
   * colour a state is. `periodTotal` has no status — it is every order in the
   * period — so it carries a calendar in the neutral hue.
   */
  status: string | null;
}

/**
 * Intake, then the three outcomes it resolves into, then the queue still owed
 * a call. `waiting` (plain `pending`) used to sit second; it was replaced by
 * `delivered` so the row ends on the outcome the business is actually paid for.
 *
 * The leading tile was pinned to the current day while its four neighbours
 * followed the date range. It now counts the same window they do, so the row
 * reads as one period and the intake figure is the denominator the outcomes
 * are actually a share of.
 */
const STAGES: StageDef[] = [
  { key: "periodTotal", count: (c) => c.periodTotal, period: "window", status: null },
  { key: "uploaded", count: (c) => c.uploaded, period: "window", status: "uploaded" },
  { key: "rejected", count: (c) => c.rejected, period: "window", status: "rejected" },
  { key: "delivered", count: (c) => c.delivered, period: "window", status: "delivered" },
  // A backlog, not an outcome: it ignores the date range entirely, because
  // "orders still owing a call" is a fact about now, not about a period.
  { key: "toRecall", count: (c) => c.toRecall, period: "now", status: "callback_scheduled" },
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

  const df = useMemo(
    () =>
      new Intl.DateTimeFormat(locale === "ar" ? "ar" : "fr-FR", {
        day: "2-digit",
        month: "short",
      }),
    [locale],
  );

  /**
   * What the windowed tiles say they measure.
   *
   * The default window is today, and then it must read "aujourd'hui" — spelling
   * out a single-day range as a date pair would make the ordinary case look like
   * a filter the user forgot they applied.
   */
  const windowLabel = useMemo(() => {
    const w = counts?.window;
    if (!w?.from && !w?.to) return t("periodToday");
    const day = (iso: string) => df.format(new Date(`${iso}T00:00:00`));
    if (w.from && !w.to) {
      return isToday(w.from) ? t("periodToday") : t("periodSince", { date: day(w.from) });
    }
    if (!w.from && w.to) return t("periodUntil", { date: day(w.to) });
    if (w.from === w.to) return day(w.from as string);
    return t("periodRange", { from: day(w.from as string), to: day(w.to as string) });
  }, [counts?.window, df, t]);

  const periodLabel = (period: StageDef["period"]) =>
    period === "now" ? t("periodNow") : windowLabel;

  /**
   * Bars compare only within one period.
   *
   * The denominator is keyed on the rendered period label, so tiles that
   * measure the same span share a scale and tiles that do not never do — a
   * backlog of 376 and a daily tally of 12 drawn against one denominator would
   * compare quantities that are not comparable.
   */
  const scaleMax = useMemo(() => {
    const max: Record<string, number> = {};
    if (!counts) return max;
    for (const s of STAGES) {
      const key = periodLabel(s.period);
      max[key] = Math.max(max[key] ?? 1, s.count(counts));
    }
    return max;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counts, windowLabel, t]);

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
          className={tileClass(activeTile === "unassigned", "min-w-[200px]")}
        >
          <span className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-hue-amber-bg text-hue-amber-ink"
            >
              <UserRound size={20} strokeWidth={2} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[26px] font-[650] leading-[1.08] tracking-[-0.022em] tabular-nums text-oms-age-warm">
                {nf.format(counts.unassigned)}
              </span>
              <span className="mt-1 block text-[10.5px] font-semibold uppercase tracking-[0.075em] text-oms-ink-2">
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
            control on this row lifts under the cursor; this one does not.

            Rendered only when there IS a rate. A market with no decisions in the
            window has an unknown rate, not a 0% one, and 0% reads as a
            catastrophe rather than as an absence of data. */}
        {counts.confirmationRate !== null && (
          <div className="flex min-w-[300px] items-center gap-3 rounded-card border border-oms-border bg-oms-surface px-3.5 py-2.5">
            <span
              aria-hidden="true"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-hue-green-bg text-hue-green-ink"
            >
              <PieChart size={20} strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-[26px] font-[650] leading-[1.08] tracking-[-0.022em] tabular-nums text-oms-ink-1">
                  {pct(counts.confirmationRate)}
                </span>
                {delta !== null && (
                  <span
                    className={
                      "inline-flex items-center gap-0.5 rounded-pill px-1.5 py-0.5 text-[11px] font-semibold tabular-nums " +
                      (delta >= 0
                        ? "bg-hue-green-bg text-hue-green-ink"
                        : "bg-hue-red-bg text-hue-red-ink")
                    }
                  >
                    {delta >= 0 ? "▲" : "▼"} {nf.format(Math.abs(Math.round(delta * 10) / 10))}
                  </span>
                )}
              </div>
              <div className="mt-1 text-[10.5px] font-semibold uppercase tracking-[0.075em] text-oms-ink-2">
                {t("confirmationRate")}
              </div>
              {/* The sample size travels with the rate. A percentage on its own
                  cannot be judged — 100% of two calls and 100% of two hundred
                  are the same number and completely different facts. */}
              <div className="mt-px text-[10.5px] text-oms-ink-3">
                {t("rateSample", { count: nf.format(counts.confirmationSample) })}
                {delta !== null ? ` · ${t("ratePeriod")}` : ""}
              </div>
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
              const period = periodLabel(stage.period);
              // Queue tiles are the standing figures; everything else is drawn
              // as a period tally (hollow bar).
              const daily = stage.period !== "now";
              const width = Math.max(4, (n / (scaleMax[period] || 1)) * 100);
              return (
                <div key={stage.key} className="flex min-w-[118px] flex-1 basis-[128px] items-stretch">
                  <button
                    type="button"
                    aria-pressed={active}
                    // Explicit: the visible label and the period label would
                    // otherwise concatenate into an ambiguous accessible name
                    // ("Confirmées aujourd'hui" vs the "Aujourd'hui" tile).
                    aria-label={`${t(stage.key)}: ${nf.format(n)} (${period})`}
                    onClick={() => toggle(stage.key)}
                    className={tileClass(active, "flex-1 min-w-0 !px-3 !py-2")}
                  >
                    <span className="flex items-center gap-3">
                      <TileIcon status={stage.status} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[23px] font-[650] leading-[1.08] tracking-[-0.022em] tabular-nums text-oms-ink-1">
                          {nf.format(n)}
                        </span>
                        <span className="mt-1 block truncate text-[10.5px] font-semibold uppercase tracking-[0.075em] text-oms-ink-2">
                          {t(stage.key)}
                        </span>
                        <span className="mt-px block truncate text-[10.5px] font-normal text-oms-ink-3">
                          {period}
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

/** Local calendar day, matching how the window default is seeded client-side. */
function isToday(iso: string): boolean {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return iso === `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
      className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${HOLDER_BG[hue]} ${HOLDER_INK[hue]}`}
    >
      {face ? <StatusIcon name={face.icon} size={20} /> : <CalendarDays size={20} strokeWidth={2} />}
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
