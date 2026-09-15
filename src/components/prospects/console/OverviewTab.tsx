"use client";

/**
 * « Vue d'ensemble » — what a manager reads when the page opens.
 *
 * It leads with the red banner, not with the KPIs, because of what production
 * actually looks like: on 2026-09-15, 1 984 of 1 992 prospects had no agent at
 * all. No queue showed them and nobody called them. A page that opened on a
 * tidy row of numbers would have hidden the only thing worth doing.
 *
 * Pure: every figure arrives as a prop, the clock included.
 * Design: prototypes/prospects-manager-v1.html (overviewBody).
 */
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle, Clock, Flame, Hand, Megaphone, Phone, ShieldCheck, Users,
} from "lucide-react";
import {
  conversionRate, funnelWidths, type AgentLoadRanked, type CampaignResult,
  type ConsoleMetrics, type Funnel, type LossByReason,
} from "@/lib/prospects/console";
import { Money } from "../ui";
import {
  Alert, Avatar, Bar, CARD, Delta, Empty, fmt, FunnelRow, Hint, Kpi, LossRow,
  SectionHead,
} from "./ui";
import { CampaignCard } from "./CampaignCard";

export interface OverviewTabProps {
  metrics: ConsoleMetrics;
  funnel: Funnel;
  loss: LossByReason;
  campaigns: CampaignResult[];
  agents: AgentLoadRanked[];
  marketCode: "ly" | "tn";
  locale: string;
  /** Jump to another tab, optionally with a filter already applied. */
  onGo: (tab: "pipeline" | "campaigns" | "team", filter?: string) => void;
  onDistribute: () => void;
  onOpenAgent: (agentId: string) => void;
}

export function OverviewTab({
  metrics, funnel, loss, campaigns, agents, marketCode, locale, onGo, onDistribute, onOpenAgent,
}: OverviewTabProps) {
  const t = useTranslations("prospects.console");
  const tLost = useTranslations("prospects.lost");

  /** The agent whose hot prospect has waited longest — the one to nudge. */
  const worstHot = useMemo(
    () => agents.filter((a) => a.hot_waiting > 0).sort((a, b) => b.hot_waiting - a.hot_waiting)[0] ?? null,
    [agents],
  );

  const idle = useMemo(() => agents.filter((a) => a.calls_today === 0 && a.open_leads > 0), [agents]);

  const lossRows = useMemo(
    () => Object.entries(loss).map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n),
    [loss],
  );
  const lossTotal = lossRows.reduce((s, r) => s + r.n, 0);
  const lossMax = lossRows[0]?.n ?? 0;

  const rate = metrics.converted_30d > 0 && funnel.called > 0
    ? Math.round((metrics.converted_30d / funnel.called) * 100)
    : null;

  const live = campaigns.filter((c) => (c.pool ?? 0) > 0 || c.called < c.audience).slice(0, 2);

  return (
    <div className="flex flex-col gap-3.5">
      {/* The finding, first. Nothing else on this page matters as much. */}
      {metrics.pool > 0 ? (
        <Alert
          tone="red"
          icon={Users}
          title={t("alert.poolTitle", { n: metrics.pool })}
          desc={t("alert.poolDesc", {
            c: metrics.pool_campaigns,
            days: metrics.pool_oldest_days ?? 0,
          })}
          cta={t("alert.poolCta")}
          onCta={onDistribute}
        />
      ) : null}

      {worstHot && metrics.oldest_hot_minutes !== null ? (
        <Alert
          tone="amber"
          icon={Flame}
          title={t("alert.hotTitle", { n: metrics.hot_waiting })}
          desc={t("alert.hotDesc", {
            minutes: metrics.oldest_hot_minutes,
            agent: metrics.oldest_hot_agent ?? worstHot.name,
          })}
          cta={t("alert.hotCta")}
          onCta={() => onGo("team")}
        />
      ) : null}

      <SectionHead title={t("ks.health")} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi
          label={t("k.new")}
          value={fmt(metrics.new_7d, locale)}
          detail={<Delta current={metrics.new_7d} previous={metrics.new_prev_7d} suffix={t("kd.vs")} locale={locale} />}
        />
        <Kpi
          label={t("k.tocall")}
          value={fmt(metrics.never_called, locale)}
          tone={metrics.never_called > 50 ? "red" : "plain"}
          detail={t("kd.of", { n: fmt(metrics.total, locale) })}
          onClick={() => onGo("pipeline", "unassigned")}
        />
        <Kpi
          label={t("k.hot")}
          value={fmt(metrics.hot_waiting, locale)}
          unit={t("kd.now")}
          icon={Flame}
          tone={metrics.hot_waiting > 0 ? "amber" : "plain"}
          detail={
            metrics.oldest_hot_minutes !== null
              ? t("kd.oldest", { minutes: metrics.oldest_hot_minutes })
              : t("noHot")
          }
          onClick={() => onGo("team")}
        />
        <Kpi
          label={t("k.ttc")}
          value={metrics.median_first_contact_minutes !== null
            ? fmt(metrics.median_first_contact_minutes, locale)
            : "—"}
          unit={metrics.median_first_contact_minutes !== null ? "min" : undefined}
          detail={
            metrics.median_first_contact_minutes !== null && metrics.median_first_contact_prev
              ? <Delta
                  current={metrics.median_first_contact_minutes}
                  previous={metrics.median_first_contact_prev}
                  suffix={t("kd.vs")}
                  lowerIsBetter
                  locale={locale}
                />
              : t("kd.target")
          }
        />
        <Kpi
          label={t("k.late")}
          value={fmt(metrics.late_callbacks, locale)}
          tone={metrics.late_callbacks > 0 ? "amber" : "plain"}
          detail={t("kd.late", { n: agents.filter((a) => (a.late_callbacks ?? 0) > 0).length })}
          onClick={() => onGo("pipeline", "callback")}
        />
      </div>

      <SectionHead title={t("ks.money")} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label={t("k.conv")}
          value={fmt(metrics.converted_30d, locale)}
          detail={t("kd.vs")}
          onClick={() => onGo("pipeline", "converted")}
        />
        <Kpi
          label={t("k.rate")}
          value={rate !== null ? `${fmt(rate, locale)} %` : "—"}
          detail={t("kd.rate")}
        />
        <Kpi
          label={t("k.rev")}
          tone="green"
          value={<Money amount={metrics.delivered_revenue_30d} market={marketCode} locale={locale} />}
          detail={t("kd.rev", { n: metrics.delivered_30d })}
        />
        <Kpi
          label={t("k.lost")}
          value={fmt(metrics.lost_30d, locale)}
          detail={
            lossRows.length > 0
              ? t("kd.lost", { reason: safeReason(tLost, lossRows[0].reason) })
              : t("kd.vs")
          }
          onClick={() => onGo("pipeline", "lost")}
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-3.5 lg:grid-cols-[1.4fr_1fr]">
        {/* Where the stock stops. */}
        <section className={CARD}>
          <h3 className="m-0 flex items-baseline gap-2 border-b border-[#E5E7EB] px-4 py-3.5 text-[15px] font-bold text-[#111827]">
            {t("fun.t")}
            <span className="ms-auto text-[13px] font-medium text-[#6B7280]">
              {fmt(funnel.created, locale)} {t("fun.sub")}
            </span>
          </h3>
          <div className="flex flex-col gap-2 px-4 py-3.5">
            <FunnelRow label={t("fun.pool")} value={funnel.pool} total={funnel.created} tone="red" locale={locale} />
            <FunnelRow label={t("fun.assigned")} value={funnel.assigned} total={funnel.created} locale={locale} />
            <FunnelRow label={t("fun.called")} value={funnel.called} total={funnel.created} locale={locale} />
            <FunnelRow label={t("fun.reached")} value={funnel.reached} total={funnel.created} locale={locale} />
            <FunnelRow label={t("fun.conv")} value={funnel.conv} total={funnel.created} tone="brand" locale={locale} />
            <FunnelRow label={t("fun.deliv")} value={funnel.deliv} total={funnel.created} tone="green" locale={locale} />
          </div>
        </section>

        {/* Why it leaves. */}
        <section className={CARD}>
          <h3 className="m-0 flex items-baseline gap-2 border-b border-[#E5E7EB] px-4 py-3.5 text-[15px] font-bold text-[#111827]">
            {t("loss.t")}
            <span className="ms-auto text-[13px] font-medium text-[#6B7280]">
              {fmt(lossTotal, locale)} {t("loss.total")}
            </span>
          </h3>
          {lossRows.length === 0 ? (
            <Empty>{t("empty.pipeline")}</Empty>
          ) : (
            <div className="flex flex-col gap-2 px-4 py-3.5">
              {lossRows.map((r) => (
                <LossRow key={r.reason} label={safeReason(tLost, r.reason)} value={r.n} max={lossMax} locale={locale} />
              ))}
              {lossTotal > 0 && (loss.price ?? 0) / lossTotal >= 0.25 ? (
                <Hint icon={AlertTriangle}>
                  {t("loss.hint", { pct: Math.round(((loss.price ?? 0) / lossTotal) * 100) })}
                </Hint>
              ) : null}
            </div>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 items-start gap-3.5 lg:grid-cols-[1fr_1.4fr]">
        {/* The campaigns still producing work. */}
        <section className={CARD}>
          <h3 className="m-0 flex items-baseline gap-2 border-b border-[#E5E7EB] px-4 py-3.5 text-[15px] font-bold text-[#111827]">
            {t("camps.t")}
            <button
              type="button"
              onClick={() => onGo("campaigns")}
              className="ms-auto text-[13px] font-semibold text-[#2563EB] hover:underline"
            >
              {t("camps.see")}
            </button>
          </h3>
          {live.length === 0 ? (
            <Empty>{t("camps.none")}</Empty>
          ) : (
            live.map((c) => (
              <CampaignCard key={c.id} campaign={c} compact marketCode={marketCode} locale={locale} />
            ))
          )}
        </section>

        {/* Who is doing what today. */}
        <section className={CARD}>
          <h3 className="m-0 border-b border-[#E5E7EB] px-4 py-3.5 text-[15px] font-bold text-[#111827]">
            {t("agt.t")}
          </h3>
          {agents.length === 0 ? (
            <Empty>{t("empty.agents")}</Empty>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[13.5px]">
                  <thead>
                    <tr>
                      {["agent", "calls", "reached", "conv", "rate", "queue", "hot"].map((k, i) => (
                        <th
                          key={k}
                          scope="col"
                          className={`whitespace-nowrap border-b border-[#E5E7EB] px-3 py-2.5 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-[#6B7280] ${
                            i === 0 ? "text-start" : "text-end"
                          }`}
                        >
                          {i === 0 ? t("th.agent") : t(`agt.${k}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {agents.map((a) => (
                      <tr
                        key={a.id}
                        onClick={() => onOpenAgent(a.id)}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpenAgent(a.id); }
                        }}
                        className="cursor-pointer border-b border-[#F3F4F6] transition-colors last:border-b-0 hover:bg-[#F9FAFB] focus-visible:bg-[#F0FDF4] focus-visible:outline-none"
                      >
                        <td className="px-3 py-2.5">
                          <span className="inline-flex items-center gap-2">
                            <Avatar name={a.name} size="sm" online={(a.last_touch_minutes ?? 999) < 30} />
                            <span className="font-semibold text-[#111827] [unicode-bidi:plaintext]">{a.name}</span>
                            {a.calls_today === 0 ? (
                              <span className="rounded-full bg-[#F3F4F6] px-2 py-0.5 text-[11.5px] text-[#6B7280]">
                                {t("agt.noCalls")}
                              </span>
                            ) : null}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-end tabular-nums">{fmt(a.calls_today, locale)}</td>
                        <td className="px-3 py-2.5 text-end tabular-nums">{fmt(a.reached_today ?? 0, locale)}</td>
                        <td className="px-3 py-2.5 text-end font-semibold tabular-nums">{fmt(a.converted_today, locale)}</td>
                        <td className="px-3 py-2.5 text-end">
                          {a.rate !== null ? (
                            <span className="inline-flex items-center justify-end gap-2">
                              <Bar pct={a.rate} className="w-14" />
                              <b className="tabular-nums">{fmt(a.rate, locale)} %</b>
                            </span>
                          ) : (
                            <span aria-hidden className="text-[#D1D5DB]">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-end tabular-nums text-[#374151]">{fmt(a.open_leads, locale)}</td>
                        <td className="px-3 py-2.5 text-end">
                          {a.hot_waiting > 0 ? (
                            <b className="tabular-nums text-[#92400E]">{fmt(a.hot_waiting, locale)}</b>
                          ) : (
                            <span aria-hidden className="text-[#D1D5DB]">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {idle.length > 0 ? (
                <div className="px-4 pb-3.5 pt-1">
                  <Hint icon={Hand}>
                    {t("agt.idle", {
                      names: idle.map((a) => a.name).join(", "),
                      n: idle.length,
                      queue: fmt(idle.reduce((s, a) => s + a.open_leads, 0), locale),
                    })}
                  </Hint>
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * A loss reason as a person would say it. The enum has eight values and
 * `prospects.lost` names five of them; the rest fall back to the key rather
 * than rendering the raw ICU error.
 */
function safeReason(t: (k: string) => string, reason: string): string {
  try {
    return t(reason);
  } catch {
    return reason;
  }
}
