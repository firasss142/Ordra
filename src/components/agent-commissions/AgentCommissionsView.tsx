"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { AgentCommissions, AgentHistoryItem } from "@/lib/commissions/types";
import { fmtCommission } from "@/lib/commissions/view-models";

interface Props {
  me: AgentCommissions;
  marketCode: string;
  locale: string;
  tz: string;
  onMore: () => void;
}

/**
 * "Mes commissions" — deliberately minimal: one number (À recevoir), three
 * facts (ce mois · en cours · dernier paiement), one history grouped by day
 * that opens to the orders. Read-only; the manager records payments.
 */
export function AgentCommissionsView({ me, marketCode, locale, tz, onMore }: Props) {
  const t = useTranslations("agentCommissions");
  const tm = useTranslations("team.commissions.method");
  const fmtD = (iso: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: tz }).format(new Date(iso));
  const fmtDay = (day: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(`${day}T12:00:00Z`));
  const money = (n: number, signed = false) => fmtCommission(n, marketCode, { signed });

  if (!me.enabled && me.balance === 0 && me.history.length === 0) {
    return (
      <div className="mx-auto max-w-[640px] px-5 py-10 text-center">
        <p className="text-[15px] font-semibold text-agent-on-surface">{t("disabledTitle")}</p>
        <p className="mt-1 text-[13px] text-agent-ink-3">{t("disabledHint")}</p>
      </div>
    );
  }

  const negative = me.balance < 0;
  return (
    <div className="mx-auto max-w-[640px] px-5 pb-16 pt-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h1 className="m-0 text-[20px] font-bold text-agent-on-surface">{t("title")}</h1>
        {me.rate !== null && me.enabled && (
          <span className="text-[12.5px] text-agent-ink-3">
            {t.rich("rate", { rate: money(me.rate), b: (c) => <b className="text-agent-on-surface">{c}</b> })}
          </span>
        )}
      </div>

      <section className="rounded-xl border border-agent-outline-variant bg-agent-surface">
        <div className="px-[22px] pb-[18px] pt-[22px]">
          <div className="text-[12.5px] tracking-[.02em] text-agent-on-surface-variant">{t("toReceive")}</div>
          <div className={`mt-1 text-[40px] font-extrabold leading-[1.05] tabular-nums ${negative ? "text-agent-error" : "text-agent-on-surface"}`}>{money(me.balance)}</div>
          <div className="mt-2 text-[13px] text-agent-on-surface-variant">
            {negative
              ? t("negative", { amount: money(-me.balance) })
              : me.last_payout
                ? t.rich("sinceLastPayout", { date: fmtD(me.last_payout.at), delivered: me.since_last_payout.delivered, corrections: me.since_last_payout.corrections, b: (c) => <b className="text-agent-on-surface">{c}</b> })
                : t("sinceStart", { delivered: me.since_last_payout.delivered })}
          </div>
        </div>
        <div className="grid grid-cols-3 border-t border-agent-outline-variant">
          <div className="border-e border-agent-outline-variant px-[18px] py-3.5">
            <div className="text-[12px] text-agent-ink-3">{t("month")}</div>
            <div className="mt-0.5 text-[18px] font-bold text-agent-on-surface">{t("monthDelivered", { n: me.month.delivered })}</div>
            <div className="text-[12.5px] tabular-nums text-agent-on-surface-variant">{money(me.month.earned, true)}</div>
          </div>
          <div className="border-e border-agent-outline-variant px-[18px] py-3.5">
            <div className="text-[12px] text-agent-ink-3">{t("inflight")}</div>
            <div className="mt-0.5 text-[18px] font-bold text-agent-on-surface-variant">{t("inflightCount", { n: me.inflight.count })}</div>
            <div className="text-[12.5px] tabular-nums text-agent-ink-3">{t("inflightEst", { amount: money(me.inflight.est) })}</div>
          </div>
          <div className="px-[18px] py-3.5">
            <div className="text-[12px] text-agent-ink-3">{t("lastPayout")}</div>
            <div className="mt-0.5 text-[18px] font-bold text-agent-on-surface">{me.last_payout ? fmtD(me.last_payout.at) : t("noPayout")}</div>
            {me.last_payout && (
              <div className="text-[12.5px] tabular-nums text-agent-on-surface-variant">{money(me.last_payout.amount)}{me.last_payout.method ? ` · ${tm(me.last_payout.method)}` : ""}</div>
            )}
          </div>
        </div>
      </section>

      <section className="mt-3.5 rounded-xl border border-agent-outline-variant bg-agent-surface">
        <div className="flex items-baseline justify-between border-b border-agent-outline-variant px-[18px] py-3.5">
          <b className="text-[15px] text-agent-on-surface">{t("history")}</b>
          <small className="text-[12.5px] text-agent-ink-3">{t("historyHint")}</small>
        </div>
        {me.history.length === 0 && <p className="px-[18px] py-6 text-[13.5px] text-agent-ink-3">{t("empty")}</p>}
        {me.history.map((item, i) => <HistoryRow key={i} item={item} money={money} fmtD={fmtD} fmtDay={fmtDay} />)}
        <div className="flex items-center justify-between gap-3 px-[18px] py-2.5 text-[12.5px] text-agent-ink-3">
          {me.has_more ? <button type="button" onClick={onMore} className="text-agent-primary hover:underline">{t("more")}</button> : <span />}
          <span>{t("rule")}</span>
        </div>
      </section>
    </div>
  );
}

function HistoryRow({ item, money, fmtD, fmtDay }: { item: AgentHistoryItem; money: (n: number, s?: boolean) => string; fmtD: (iso: string) => string; fmtDay: (d: string) => string }) {
  const t = useTranslations("agentCommissions");
  const tm = useTranslations("team.commissions.method");
  const [open, setOpen] = useState(false);
  const rowCls = "flex items-center gap-3 px-[18px] py-[11px] text-[13.5px] border-b border-agent-outline-variant last:border-b-0";
  const dCls = "w-[96px] shrink-0 text-[12.5px] text-agent-ink-3";
  const mCls = "ms-3 min-w-[64px] shrink-0 text-end font-bold tabular-nums";

  if (item.type === "payout") {
    return (
      <div className={`${rowCls} bg-agent-surface-low`}>
        <span className={dCls}>{fmtD(item.at)}</span>
        <span className="min-w-0 flex-1"><b>{t("paymentReceived")}</b><small className="block text-[12px] text-agent-ink-3">{item.method ? tm(item.method) : ""}{item.reference ? ` · ${item.reference}` : ""}</small></span>
        <span className={`${mCls} text-agent-on-surface`}>{money(item.amount, true)}</span>
      </div>
    );
  }
  if (item.type === "adjustment") {
    return (
      <div className={rowCls}>
        <span className={dCls}>{fmtD(item.at)}</span>
        <span className="min-w-0 flex-1"><b>{t("adjustment")}</b>{item.note && <small className="block text-[12px] text-agent-ink-3">{item.note}</small>}</span>
        <span className={`${mCls} ${item.amount < 0 ? "text-agent-error" : "text-agent-on-surface"}`}>{money(item.amount, true)}</span>
      </div>
    );
  }
  const onlyCorrections = item.delivered === 0 && item.corrections > 0;
  return (
    <div className="border-b border-agent-outline-variant last:border-b-0">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={`w-full border-0 bg-transparent text-start ${rowCls} !border-b-0 hover:bg-agent-bg ${open ? "bg-agent-bg" : ""}`}>
        <span className={dCls}>{fmtDay(item.day)}</span>
        <span className="min-w-0 flex-1">
          {onlyCorrections ? t("dayCorrections", { n: item.corrections }) : t("dayDelivered", { n: item.delivered })}
          {!onlyCorrections && item.corrections > 0 && <small className="block text-[12px] text-agent-ink-3">{t("dayCorrections", { n: item.corrections })}</small>}
          {onlyCorrections && item.orders[0]?.external_id && <small className="block text-[12px] text-agent-ink-3">{t("correctionNote", { id: `#${item.orders[0].external_id}` })}</small>}
        </span>
        <span className={`${mCls} ${item.amount < 0 ? "text-agent-error" : "text-agent-on-surface"}`}>{money(item.amount, true)}</span>
      </button>
      {open && (
        <div className="grid gap-1 bg-agent-bg px-[18px] pb-2.5 ps-[114px] text-[12.5px] text-agent-on-surface-variant">
          {item.orders.map((o, i) => (
            <div key={i} className="flex justify-between gap-3">
              <span dir="auto">{o.external_id ? `#${o.external_id}` : "—"}{o.product_name ? ` · ${o.product_name}` : ""}{o.city ? ` · ${o.city}` : ""}</span>
              <span className={`font-semibold tabular-nums ${o.amount < 0 ? "text-agent-error" : ""}`}>{money(o.amount, true)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
