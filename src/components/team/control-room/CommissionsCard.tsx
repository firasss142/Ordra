"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import type { CommissionView, CommissionAgentView } from "@/lib/commissions/view-models";
import { fmtCommission } from "@/lib/commissions/view-models";
import { fmtNum } from "@/lib/team/format";
import { AgentAvatar } from "./AgentAvatar";
import { TeamCard } from "./Card";

interface Props {
  view: CommissionView;
  marketCode: string;
  locale: string;
  tz: string;
  canPay: boolean;
  onPay: (a: CommissionAgentView) => void;
  onSelectAgent: (agentId: string) => void;
  settingsHref: string;
  exportHrefFor: (agentId: string) => string;
  /** null = no market rule yet; false = market switched off */
  marketState?: { enabled: boolean; amount: number } | null;
}

/** Balance cell shared with the roster: signed money, red "doit X" pill below zero. */
export function BalanceCell({ a, marketCode, muted }: { a: CommissionAgentView; marketCode: string; muted?: boolean }) {
  const t = useTranslations("team.commissions");
  if (a.tone === "negative") {
    return (
      <span className="inline-flex items-center rounded-pill border border-status-critical bg-surface-card px-2.5 py-[3px] text-[12.5px] font-medium text-status-critical tabular-nums">
        {t("owes", { amount: fmtCommission(-a.agent.balance, marketCode) })}
      </span>
    );
  }
  if (a.tone === "zero") {
    return a.disabled && !a.unconfigured
      ? <span className="rounded-pill border border-line bg-surface-sunken px-2 py-[1px] text-[11.5px] text-ink-secondary">{t("disabled")}</span>
      : <span className="text-ink-muted">—</span>;
  }
  return (
    <span className={`font-semibold tabular-nums ${muted ? "text-ink-secondary" : "text-ink-primary"}`}>
      {fmtCommission(a.agent.balance, marketCode, { signed: true })}
      {a.disabled && !a.unconfigured && <span className="ms-2 rounded-pill border border-line bg-surface-sunken px-2 py-[1px] text-[11.5px] font-normal text-ink-secondary">{t("disabled")}</span>}
    </span>
  );
}

export function CommissionsCard({ view, marketCode, locale, tz, canPay, onPay, onSelectAgent, settingsHref, exportHrefFor, marketState }: Props) {
  const t = useTranslations("team.commissions.card");
  const tc = useTranslations("team.commissions");
  const tm = useTranslations("team.commissions.method");
  const fmtDay = (iso: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: tz }).format(new Date(iso));
  const th = "whitespace-nowrap px-3.5 py-2.5 text-start text-[12px] font-medium text-ink-secondary";
  const hint = marketState === null
    ? t("hintNoRate")
    : marketState && !marketState.enabled
      ? t("hintOff")
      : t("hint", { rate: fmtCommission(marketState?.amount ?? 0, marketCode) });

  return (
    <TeamCard>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line-subtle px-4 py-3.5">
        <div>
          <h2 className="text-[16px] font-semibold text-ink-primary">{t("title")}</h2>
          <span className="text-[12.5px] text-ink-secondary">{hint}</span>
        </div>
        <div className="flex items-center gap-2">
          <Link href={settingsHref} className="rounded-md px-2.5 py-1.5 text-[12.5px] font-medium text-ink-secondary hover:bg-surface-hover hover:text-ink-primary">{t("settingsLink")}</Link>
        </div>
      </header>
      {view.agents.length === 0 && <p className="px-4 py-6 text-[13.5px] text-ink-secondary">{t("empty")}</p>}
      {view.agents.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13.5px]">
            <thead>
              <tr className="border-b border-line">
                <th className={th}>{t("agent")}</th>
                <th className={`${th} !text-end`}>{t("delivered")}</th>
                <th className={`${th} !text-end`}>{t("earned")}</th>
                <th className={`${th} !text-end`}>{t("paid")}</th>
                <th className={th}>{t("balance")}</th>
                <th className={th}>{t("lastPayout")}</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {view.agents.map((a) => {
                const ag = a.agent;
                const showPay = canPay && (!a.disabled || ag.balance !== 0);
                return (
                  <tr key={ag.agent_id} className="cursor-pointer border-b border-line-subtle last:border-b-0 hover:bg-surface-hover" onClick={() => onSelectAgent(ag.agent_id)}>
                    <td className="px-3.5 py-3">
                      <span className="flex items-center gap-2.5">
                        <AgentAvatar name={ag.name} avatarUrl={ag.avatar_url} />
                        <span className={`text-[14px] font-semibold ${a.disabled ? "text-ink-secondary" : "text-ink-primary"}`}>{ag.name}</span>
                        {ag.rate.is_override && ag.rate.enabled && <span className="text-[11.5px] text-ink-secondary tabular-nums">{fmtCommission(ag.rate.amount, marketCode)}</span>}
                      </span>
                    </td>
                    <td className={`px-3.5 py-3 text-end tabular-nums ${ag.delivered === 0 ? "text-ink-muted" : ""}`}>{fmtNum(locale, ag.delivered)}</td>
                    <td className={`px-3.5 py-3 text-end tabular-nums ${ag.earned === 0 ? "text-ink-muted" : ""}`}>{ag.earned === 0 ? "—" : fmtCommission(ag.earned, marketCode)}</td>
                    <td className={`px-3.5 py-3 text-end tabular-nums ${ag.paid === 0 ? "text-ink-muted" : ""}`}>{ag.paid === 0 ? "—" : fmtCommission(ag.paid, marketCode)}</td>
                    <td className="px-3.5 py-3"><BalanceCell a={a} marketCode={marketCode} /></td>
                    <td className="whitespace-nowrap px-3.5 py-3 text-[12.5px] text-ink-secondary">
                      {ag.last_payout
                        ? <><b className="font-medium text-ink-primary">{fmtDay(ag.last_payout.at)}</b> · {fmtCommission(ag.last_payout.amount, marketCode)}{ag.last_payout.method ? ` · ${tm(ag.last_payout.method)}` : ""}</>
                        : ag.earned > 0 || ag.balance > 0 ? tc("neverPaid") : "—"}
                    </td>
                    <td className="px-3.5 py-3 text-end" onClick={(e) => e.stopPropagation()}>
                      {showPay && (
                        <button type="button" onClick={() => onPay(a)} className="rounded-md border border-line-strong bg-surface-card px-3 py-[6px] text-[13px] font-medium text-ink-primary hover:bg-surface-hover">
                          {t("pay")}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              <tr className="bg-surface-sunken font-semibold">
                <td className="px-3.5 py-3">{t("total")}</td>
                <td className="px-3.5 py-3 text-end tabular-nums">{fmtNum(locale, view.totals.delivered)}</td>
                <td className="px-3.5 py-3 text-end tabular-nums">{fmtCommission(view.totals.earned, marketCode)}</td>
                <td className="px-3.5 py-3 text-end tabular-nums">{fmtCommission(view.totals.paid, marketCode)}</td>
                <td className="px-3.5 py-3 tabular-nums" colSpan={3}>
                  {fmtCommission(view.totals.balance, marketCode, { signed: true })}
                  <span className="ms-2 text-[11.5px] font-normal text-ink-secondary">{t("netNote", { toPay: fmtCommission(view.totals.to_pay_sum, marketCode) })}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="px-4 py-3 text-[12px] leading-[1.5] text-ink-secondary">{t("footer")}</p>
      {/* keep the export helper referenced for the drawer/CSV link parity */}
      <span hidden aria-hidden="true">{exportHrefFor("")}</span>
    </TeamCard>
  );
}
