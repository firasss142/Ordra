"use client";

/**
 * « Prospects » — the manager console. Pure: data and the clock come in as
 * props, so every state of the page is testable.
 *
 * Four KPIs, the pipeline table, campaign funnels and the agent roster.
 * Design: prototypes/prospects-v3.html (manager view). Arithmetic:
 * src/lib/prospects/console.ts.
 */
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, FileUp, Megaphone, Users } from "lucide-react";
import {
  conversionRate, funnelWidths, trend,
  type AgentLoadRanked, type CampaignResult, type ConsoleMetrics,
} from "@/lib/prospects/console";
import { BUCKET_TONE, formatPhone, situationOf } from "@/lib/prospects/presentation";
import type { Bucket, ProspectRow } from "@/lib/prospects/types";
import { Chip, Ltr, Money, OUTLINE_BTN, PRIMARY_BTN, SIT_ICON, useDuration, useSituationLabel } from "./ui";

export interface ProspectsConsoleProps {
  metrics: ConsoleMetrics;
  campaigns: CampaignResult[];
  agents: AgentLoadRanked[];
  rows: ProspectRow[] | null;
  error: boolean;
  isLoading: boolean;
  truncated?: boolean;
  onRetry: () => void;
  marketCode: "ly" | "tn";
  tz: string;
  locale: string;
  now: number;
  onNewCampaign: () => void;
  onImportCsv: () => void;
  onOpenProspect: (row: ProspectRow) => void;
}

type Filter = "all" | Bucket | "unassigned";
const FILTERS: Filter[] = ["all", "hot", "callback", "campaign", "winback", "unassigned"];

const card = "rounded-xl border border-[#E5E7EB] bg-white";
const kpiLabel = "text-[13px] text-[#6B7280]";
const kpiValue = "text-[26px] font-bold tracking-[-0.02em] text-[#111827] tabular-nums";
const kpiSub = "text-[12.5px] text-[#6B7280]";

/** One KPI tile. A group so a test — and a screen reader — can address it. */
function Kpi({
  label, children, sub, hot = false,
}: { label: string; children: React.ReactNode; sub: React.ReactNode; hot?: boolean }) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`flex flex-col gap-1 px-4 py-3.5 ${card} ${hot ? "border-[#F59E0B] bg-[#FFFBEB]" : ""}`}
    >
      <span className={kpiLabel}>{label}</span>
      <span className={kpiValue}>{children}</span>
      <span className={kpiSub}>{sub}</span>
    </div>
  );
}

/** "+12 %" in green, "−20 %" in red, nothing at all when there is no baseline. */
function TrendPill({ current, previous, suffix, lowerIsBetter = false }: {
  current: number; previous: number; suffix: string; lowerIsBetter?: boolean;
}) {
  const t = trend(current, previous);
  if (!t) return null;
  const good = t.direction === "flat" || (lowerIsBetter ? t.direction === "down" : t.direction === "up");
  return (
    <>
      <b className={`font-semibold tabular-nums ${good ? "text-[#15803D]" : "text-[#B91C1C]"}`}>
        {t.pct > 0 ? "+" : ""}{t.pct} %
      </b>{" "}{suffix}
    </>
  );
}

export function ProspectsConsole(props: ProspectsConsoleProps) {
  const {
    metrics, campaigns, agents, rows, error, isLoading, truncated, onRetry,
    marketCode, tz, locale, now, onNewCampaign, onImportCsv, onOpenProspect,
  } = props;
  const t = useTranslations("prospects");
  const tc = useTranslations("prospects.console");
  const duration = useDuration();
  const situationLabel = useSituationLabel(tz, locale);

  const [filter, setFilter] = useState<Filter>("all");

  const all = useMemo(() => rows ?? [], [rows]);
  const shown = useMemo(() => {
    if (filter === "all") return all;
    if (filter === "unassigned") return all.filter((r) => !r.assigned_to);
    return all.filter((r) => r.bucket === filter);
  }, [all, filter]);

  // The finding this rebuild surfaced: campaign prospects nobody owns, so no
  // agent's queue shows them. Counted from what is on screen, not guessed.
  const unassigned = useMemo(() => all.filter((r) => !r.assigned_to).length, [all]);

  const convRate = metrics.converted_30d > 0
    ? Math.round((metrics.delivered_30d / metrics.converted_30d) * 100)
    : null;

  return (
    <div className={`mx-auto flex w-full max-w-[1560px] flex-col gap-4 px-4 pb-10 pt-4 text-start lg:px-5 ${locale === "ar" ? "font-cairo" : ""}`}>
      <header className="flex flex-wrap items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[10px] bg-[#E9F6EE] text-[#15803D]">
          <Users size={22} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-[24px] font-bold leading-tight tracking-[-0.02em] text-[#111827] lg:text-[26px]">
            {tc("title")}
          </h1>
          <p className="mt-0.5 mb-0 text-[14.5px] text-[#6B7280]">{tc("sub")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onImportCsv} className={`h-10 px-3.5 text-[14px] ${OUTLINE_BTN} border-[#E5E7EB]`}>
            <FileUp size={16} aria-hidden />
            <span className="hidden sm:inline">{tc("importCsv")}</span>
            <span className="sm:hidden">CSV</span>
          </button>
          <button type="button" onClick={onNewCampaign} className={`h-10 px-3.5 text-[14px] ${PRIMARY_BTN}`}>
            <Megaphone size={16} aria-hidden />
            {tc("newCampaign")}
          </button>
        </div>
      </header>

      {/* The four figures a manager reads first. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label={tc("kpi.new")}
          sub={<TrendPill current={metrics.new_7d} previous={metrics.new_prev_7d} suffix={tc("kpi.vsPrev")} />}
        >
          {metrics.new_7d}
        </Kpi>

        <Kpi
          label={tc("kpi.hot")}
          hot={metrics.hot_waiting > 0}
          sub={
            metrics.oldest_hot_minutes !== null
              ? tc("kpi.oldestWaiting", { minutes: duration(metrics.oldest_hot_minutes) })
              : tc("kpi.noneWaiting")
          }
        >
          {metrics.hot_waiting}
          <small className="ms-1 text-[13px] font-medium text-[#6B7280]">{tc("kpi.now")}</small>
        </Kpi>

        <Kpi
          label={tc("kpi.ttc")}
          sub={
            metrics.median_first_contact_minutes !== null && metrics.median_first_contact_prev !== null
              ? <TrendPill
                  current={metrics.median_first_contact_minutes}
                  previous={metrics.median_first_contact_prev}
                  suffix={tc("kpi.vsPrev30")}
                  lowerIsBetter
                />
              : tc("kpi.median")
          }
        >
          {metrics.median_first_contact_minutes !== null
            ? duration(metrics.median_first_contact_minutes)
            : <span className="text-[15px] font-medium text-[#6B7280]">{tc("kpi.noData")}</span>}
        </Kpi>

        <Kpi
          label={tc("kpi.revenue")}
          sub={
            convRate !== null
              ? tc("kpi.delivered", { delivered: metrics.delivered_30d, rate: convRate })
              : tc("kpi.notYet")
          }
        >
          <Money amount={metrics.delivered_revenue_30d} market={marketCode} locale={locale} />
        </Kpi>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* The pipeline. */}
        <section className={`min-w-0 overflow-hidden ${card}`}>
          <h2 className="m-0 flex items-center gap-2.5 border-b border-[#E5E7EB] px-4 py-3.5 text-[15px] font-bold text-[#111827]">
            {tc("pipeline")}
            <span className="ms-auto text-[13px] font-medium text-[#6B7280]">
              {tc("count", { n: shown.length })}
            </span>
          </h2>

          <div className="flex flex-wrap items-center gap-1.5 border-b border-[#E5E7EB] px-3.5 py-2.5">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={`inline-flex h-[30px] items-center rounded-full border px-3 text-[13px] transition-colors ${
                  filter === f
                    ? "border-[#111111] bg-[#111111] text-white"
                    : "border-[#D1D5DB] bg-white text-[#111827] hover:bg-[#F9FAFB]"
                }`}
              >
                {tc(`filters.${f}`)}
              </button>
            ))}
          </div>

          {unassigned > 0 ? (
            <p className="m-0 flex items-start gap-2 border-b border-[#FDE68A] bg-[#FFFBEB] px-4 py-2.5 text-[13.5px] text-[#92400E]">
              <AlertCircle size={16} aria-hidden className="mt-px shrink-0" />
              {tc("distributionWarning", { n: unassigned })}
            </p>
          ) : null}

          {truncated ? (
            <p className="m-0 border-b border-[#FDE68A] bg-[#FFFBEB] px-4 py-2.5 text-[13.5px] text-[#92400E]">
              {t("truncated", { n: shown.length })}
            </p>
          ) : null}

          {error ? (
            <div className="px-5 py-10 text-center">
              <AlertCircle size={34} aria-hidden className="mx-auto text-[#D1D5DB]" />
              <p className="mt-3 mb-3 text-[15px] text-[#374151]">{t("loadError")}</p>
              <button type="button" onClick={onRetry} className={`h-10 px-4 text-[14px] ${OUTLINE_BTN} border-[#E5E7EB]`}>
                {t("retry")}
              </button>
            </div>
          ) : shown.length === 0 && !isLoading ? (
            <p className="m-0 px-5 py-12 text-center text-[15px] text-[#6B7280]">{tc("empty.pipeline")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table aria-label={tc("pipeline")} aria-busy={isLoading ? "true" : "false"} className="w-full border-collapse text-[13.5px]">
                <thead>
                  <tr>
                    {(["who", "source", "agent", "situation", "since", "value"] as const).map((k) => (
                      <th
                        key={k}
                        scope="col"
                        className={`border-b border-[#E5E7EB] px-3.5 py-2.5 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-[#6B7280] whitespace-nowrap ${
                          k === "value" ? "text-end" : "text-start"
                        }`}
                      >
                        {tc(`th.${k}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => {
                    const sit = situationOf(r, now);
                    const SitIcon = SIT_ICON[sit.key];
                    return (
                      <tr
                        key={r.id}
                        onClick={() => onOpenProspect(r)}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenProspect(r); }
                        }}
                        className="cursor-pointer border-b border-[#F3F4F6] transition-colors last:border-b-0 hover:bg-[#F9FAFB] focus-visible:bg-[#F0FDF4] focus-visible:outline-none"
                      >
                        <td className="px-3.5 py-2.5 align-middle">
                          <div className="font-semibold text-[#111827] [unicode-bidi:plaintext]">{r.customer_name}</div>
                          <div className="mt-0.5 max-w-[260px] truncate text-[12.5px] text-[#6B7280]">
                            <Ltr>{formatPhone(r.customer_phone)}</Ltr>
                            {r.customer_city ? <span className="[unicode-bidi:plaintext]"> · {r.customer_city}</span> : null}
                          </div>
                        </td>
                        <td className="px-3.5 py-2.5 align-middle whitespace-nowrap text-[#374151]">
                          {t(`sources.${r.source}`)}
                        </td>
                        <td className="px-3.5 py-2.5 align-middle whitespace-nowrap">
                          {r.assigned_name ? (
                            <span className="inline-flex items-center gap-2 text-[#111827]">
                              <span aria-hidden className="grid h-6 w-6 place-items-center rounded-full bg-[#F3F4F6] text-[11px] font-bold uppercase">
                                {r.assigned_name.trim().charAt(0)}
                              </span>
                              {r.assigned_name}
                            </span>
                          ) : (
                            <span className="text-[#B91C1C]">{tc("unassigned")}</span>
                          )}
                        </td>
                        <td className="px-3.5 py-2.5 align-middle">
                          <Chip tone={BUCKET_TONE[r.bucket]} icon={SitIcon}>{situationLabel(sit)}</Chip>
                        </td>
                        <td className="px-3.5 py-2.5 align-middle whitespace-nowrap text-[#6B7280]">
                          {duration(Math.max(0, (now - Date.parse(r.created_at)) / 60_000))}
                        </td>
                        <td className="px-3.5 py-2.5 text-end align-middle font-semibold whitespace-nowrap">
                          {r.product_price !== null
                            ? <Money amount={r.product_price} market={marketCode} locale={locale} />
                            : <span aria-hidden className="text-[#D1D5DB]">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="flex min-w-0 flex-col gap-4">
          {/* Campaign results. */}
          <section className={`overflow-hidden ${card}`}>
            <h2 className="m-0 border-b border-[#E5E7EB] px-4 py-3.5 text-[15px] font-bold text-[#111827]">
              {tc("campaigns")}
            </h2>
            {campaigns.length === 0 ? (
              <p className="m-0 px-4 py-8 text-center text-[14px] text-[#6B7280]">{tc("empty.campaigns")}</p>
            ) : (
              campaigns.map((c) => {
                const w = funnelWidths(c);
                const rate = conversionRate(c);
                return (
                  <div
                    key={c.id}
                    role="group"
                    aria-label={c.name}
                    className="flex flex-col gap-2 border-b border-[#F3F4F6] px-4 py-3.5 last:border-b-0"
                  >
                    <div className="flex items-center gap-2">
                      <Megaphone size={15} aria-hidden className="shrink-0 text-[#6B7280]" />
                      <span className="min-w-0 flex-1 truncate font-semibold text-[#111827] [unicode-bidi:plaintext]">
                        {c.name}
                      </span>
                      <span className="shrink-0 text-[12.5px] font-semibold text-[#15803D]">
                        {rate !== null ? tc("funnel.rate", { n: rate }) : tc("funnel.noCalls")}
                      </span>
                    </div>
                    {c.offer ? (
                      <p className="m-0 line-clamp-1 text-[13px] text-[#374151] [unicode-bidi:plaintext]">{c.offer}</p>
                    ) : null}

                    {/* Three segments, one bar, drawn to the audience. */}
                    <span role="img" aria-label={c.name} className="flex h-2.5 overflow-hidden rounded-full bg-[#F3F4F6]">
                      <span style={{ width: `${w.uncalled}%` }} className="block h-full bg-[#C7CDD6]" />
                      <span style={{ width: `${w.called}%` }} className="block h-full bg-[#8C96A5]" />
                      <span style={{ width: `${w.converted}%` }} className="block h-full bg-[#15803D]" />
                    </span>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[#6B7280]">
                      <span><b className="font-semibold tabular-nums text-[#111827]">{c.audience}</b> {tc("funnel.audience")}</span>
                      <span><b className="font-semibold tabular-nums text-[#111827]">{c.called}</b> {tc("funnel.called")}</span>
                      <span><b className="font-semibold tabular-nums text-[#111827]">{c.converted}</b> {tc("funnel.converted")}</span>
                      <span className="ms-auto font-semibold text-[#15803D]">
                        <Money amount={c.revenue} market={marketCode} locale={locale} />
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </section>

          {/* The roster, worst-served first. */}
          <section role="group" aria-label={tc("roster")} className={`overflow-hidden ${card}`}>
            <h2 className="m-0 border-b border-[#E5E7EB] px-4 py-3.5 text-[15px] font-bold text-[#111827]">
              {tc("roster")}
            </h2>
            {agents.length === 0 ? (
              <p className="m-0 px-4 py-8 text-center text-[14px] text-[#6B7280]">{tc("empty.agents")}</p>
            ) : (
              <ul className="m-0 list-none p-0">
                {agents.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 border-b border-[#F3F4F6] px-4 py-2.5 last:border-b-0">
                    <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#F3F4F6] text-[12px] font-bold uppercase text-[#111827]">
                      {a.name.trim().charAt(0)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-semibold text-[#111827] [unicode-bidi:plaintext]">
                        {a.name}
                      </span>
                      <span className={`block text-[12px] ${a.hot_waiting > 0 ? "font-semibold text-[#92400E]" : "text-[#6B7280]"}`}>
                        {a.hot_waiting > 0
                          ? tc("agent.hotWaiting", { n: a.hot_waiting })
                          : a.open_leads > 0
                            ? tc("agent.open", { n: a.open_leads })
                            : tc("agent.clear")}
                      </span>
                    </span>
                    <span className="shrink-0 text-end">
                      {a.calls_today > 0 ? (
                        <>
                          <span className="block text-[13.5px] font-semibold tabular-nums text-[#111827]">
                            {tc("agent.today", { converted: a.converted_today, calls: a.calls_today })}
                          </span>
                          <span className="mt-0.5 block h-1.5 w-20 overflow-hidden rounded-full bg-[#F3F4F6]">
                            <span style={{ width: `${a.rate ?? 0}%` }} className="block h-full rounded-full bg-[#15803D]" />
                          </span>
                        </>
                      ) : (
                        <span className="text-[12px] text-[#6B7280]">{tc("agent.noCalls")}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
