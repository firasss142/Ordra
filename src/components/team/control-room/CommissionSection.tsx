"use client";

import { useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Coins } from "lucide-react";
import { fetcher } from "@/lib/swr-config";
import type { CommissionAgentView } from "@/lib/commissions/view-models";
import { fmtCommission } from "@/lib/commissions/view-models";
import type { CommissionLedgerEntry } from "@/lib/commissions/types";
import { fmtNum } from "@/lib/team/format";
import { BalanceCell } from "./CommissionsCard";

interface Props {
  a: CommissionAgentView;
  marketCode: string;
  locale: string;
  tz: string;
  /** what the period columns cover — the drawer follows the page's period */
  periodLabel: string;
  todayDelivered?: number | null;
  canPay: boolean;
  onPay: (a: CommissionAgentView) => void;
}

function SecLabel({ children }: { children: string }) {
  return (
    <div className="mb-2.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
      <Coins size={12} strokeWidth={2} aria-hidden="true" />
      {children}
    </div>
  );
}

function KV({ v, l, muted }: { v: React.ReactNode; l: string; muted?: boolean }) {
  return (
    <div>
      <div className={`text-[15px] font-bold leading-[1.15] tabular-nums ${muted ? "text-ink-secondary" : "text-ink-primary"}`}>{v}</div>
      <div className="mt-px text-[11px] text-ink-secondary">{l}</div>
    </div>
  );
}

/** The drawer's "Commission" section — figures, the payout CTA, and the statement on demand. */
export function CommissionSection({ a, marketCode, locale, tz, periodLabel, todayDelivered, canPay, onPay }: Props) {
  const t = useTranslations("team.commissions.drawer");
  const te = useTranslations("team.commissions.entry");
  const tm = useTranslations("team.commissions.method");
  const [showLedger, setShowLedger] = useState(false);
  const ag = a.agent;
  const { data } = useSWR<{ data: CommissionLedgerEntry[] }>(showLedger ? `/api/team/commissions/${ag.agent_id}/ledger` : null, fetcher, { revalidateOnFocus: false });
  const rows = data?.data ?? null;
  const fmtDT = (iso: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(iso));
  const fmtD = (iso: string) => new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: tz }).format(new Date(iso));
  const rateLabel = !ag.rate.enabled ? t("rateOff") : ag.rate.is_override ? t("rateOverride") : t("rateMarket");

  return (
    <section className="rounded-card border border-line-subtle p-3.5">
      <SecLabel>{t("title")}</SecLabel>
      <div className="grid grid-cols-2 gap-x-3.5 gap-y-3">
        {typeof todayDelivered === "number" && (
          <KV v={<>{t("delivered", { n: todayDelivered })} · {fmtCommission(todayDelivered * (ag.rate.enabled ? ag.rate.amount : 0), marketCode, { signed: true })}</>} l={t("today")} />
        )}
        <KV v={<>{t("delivered", { n: ag.delivered })} · {fmtCommission(ag.earned, marketCode, { signed: true })}</>} l={`${t("period")} (${periodLabel})`} />
        <KV v={t("inflightValue", { n: fmtNum(locale, ag.pending_count), amount: fmtCommission(ag.pending_est, marketCode) })} l={t("inflight")} muted />
        <KV v={<>{ag.rate.enabled ? fmtCommission(ag.rate.amount, marketCode) : "—"} <span className="text-[11px] font-normal text-ink-secondary">{rateLabel}</span></>} l={t("rate")} />
        <KV v={<BalanceCell a={a} marketCode={marketCode} />} l={t("balance", { earned: fmtCommission(ag.earned_total, marketCode), paid: fmtCommission(ag.paid_total, marketCode) })} />
        <KV
          v={ag.last_payout ? <span className="text-[13.5px]">{fmtD(ag.last_payout.at)} · {fmtCommission(ag.last_payout.amount, marketCode)}{ag.last_payout.method ? ` · ${tm(ag.last_payout.method)}` : ""}</span> : <span className="text-[13.5px] text-ink-muted">{t("noPayout")}</span>}
          l={t("lastPayout")}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {canPay && (
          <button type="button" onClick={() => onPay(a)} className="rounded-md bg-brand px-3 py-[6px] text-[12.5px] font-medium text-white hover:bg-brand-hover">
            {t("recordPayment")}
          </button>
        )}
        <button type="button" onClick={() => setShowLedger((s) => !s)} className="rounded-md border border-line-strong bg-surface-card px-3 py-[6px] text-[12.5px] font-medium text-ink-primary hover:bg-surface-hover">
          {showLedger ? t("hideLedger") : t("showLedger")}
        </button>
      </div>
      {showLedger && (
        <div className="mt-3 border-t border-line-subtle pt-2">
          {rows === null && <p className="py-2 text-[12.5px] text-ink-muted">{t("loading")}</p>}
          {rows && rows.length === 0 && <p className="py-2 text-[12.5px] text-ink-muted">{t("ledgerEmpty")}</p>}
          {rows && rows.length > 0 && (
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="text-[11px] text-ink-secondary">
                  <th className="py-1 text-start font-medium">{t("colDate")}</th>
                  <th className="py-1 text-start font-medium">{t("colType")}</th>
                  <th className="py-1 text-end font-medium">{t("colAmount")}</th>
                  <th className="py-1 text-start font-medium ps-2">{t("colDetail")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 40).map((r) => (
                  <tr key={r.id} className="border-t border-line-subtle">
                    <td className="whitespace-nowrap py-1.5 text-ink-secondary">{r.entry_type === "payout" ? fmtD(r.effective_at) : fmtDT(r.effective_at)}</td>
                    <td className="py-1.5">
                      <span className={`rounded px-1.5 py-[1px] text-[10.5px] font-semibold uppercase tracking-[0.03em] ${
                        r.entry_type === "accrual" ? "bg-brand-bg text-brand-hover" : r.entry_type === "reversal" ? "bg-status-criticalBg text-status-critical" : r.entry_type === "adjustment" ? "bg-status-warningBg text-hue-amber-ink" : "bg-[#F0F1F2] text-ink-primary"
                      }`}>{te(r.entry_type)}</span>
                    </td>
                    <td className={`whitespace-nowrap py-1.5 text-end tabular-nums ${r.amount < 0 ? "text-status-critical" : ""}`}>{fmtCommission(r.amount, marketCode, { signed: true })}</td>
                    <td className="py-1.5 ps-2 text-ink-secondary" dir="auto">
                      {r.external_id ? `#${r.external_id}` : ""}{r.product_name ? ` · ${r.product_name}` : ""}
                      {r.method ? ` · ${tm(r.method)}` : ""}{r.reference ? ` · ${r.reference}` : ""}{r.note ? ` · ${r.note}` : ""}
                      {r.entry_type !== "accrual" && r.entry_type !== "reversal" ? ` · ${r.created_by_name ?? t("system")}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {rows && rows.length > 0 && (
            <div className="mt-2 flex justify-end">
              <a href={`/api/team/commissions/${ag.agent_id}/ledger?format=csv`} className="text-[12px] text-ink-secondary hover:underline">{t("export")}</a>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
