"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { ArrowUp } from "lucide-react";
import { fetcher } from "@/lib/swr-config";
import { currencyLabel, dateShort, fmtNum, money, moneySigned } from "@/lib/investors/ui-format";
import type { PortfolioPayload } from "@/lib/investors/portfolio-summary";
import { PORTFOLIO_KEY } from "./PortfolioClient";

type W = { id: string; amount: string | number; currency: string; status: "requested" | "approved" | "rejected" | "paid"; note: string | null; admin_note: string | null; requested_at: string; decided_at: string | null; paid_at: string | null; payout_reference: string | null };

export function WithdrawalsClient({ locale }: { locale: string }) {
  const t = useTranslations("investor.withdraw");
  const { data, mutate } = useSWR<{ data: W[]; balance: { available: number; open_claims: number; available_for_request: number } }>("/api/investor/withdrawals", fetcher, { refreshInterval: 60_000 });
  const { data: pf } = useSWR<{ data: PortfolioPayload }>(PORTFOLIO_KEY, fetcher);
  const cur = pf?.data?.investor.currency ?? Object.keys(pf?.data?.by_currency ?? {})[0] ?? "";
  const summary = pf?.data?.by_currency?.[cur];
  const bal = data?.balance;
  const [amount, setAmount] = useState<string>("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const maxAvail = bal?.available_for_request ?? 0;
  const value = amount === "" ? maxAvail : Number(amount.replace(",", "."));

  async function submit() {
    setBusy(true); setMsg(null);
    const res = await fetch("/api/investor/withdrawals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount: value, note: note || undefined }) });
    setBusy(false);
    if (res.ok) { setMsg({ kind: "ok", text: t("sent") }); setAmount(""); setNote(""); mutate(); }
    else { const j = await res.json().catch(() => ({})); setMsg({ kind: "err", text: j.code === "INSUFFICIENT_AVAILABLE" ? t("errorInsufficient") : t("errorGeneric") }); }
  }
  const st = (s: W["status"]) => ({ requested: ["bg-oms-warn-bg text-oms-warn-ink", t("requested")], approved: ["bg-oms-info-bg text-oms-info-ink", t("approved")], paid: ["bg-oms-ok-bg text-oms-ok", t("paid")], rejected: ["bg-oms-bad-bg text-oms-age-late", t("rejected")] }[s]);

  return (
    <div className="flex flex-col gap-3.5">
      <h1 className="m-0 text-[17px] font-semibold tracking-[-0.01em]">{t("title")}</h1>
      <section className="rounded-[10px] border border-oms-border bg-oms-surface p-3.5">
        <div className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-oms-ink-3">{t("available")}</div>
        <div className="mt-1.5 flex items-baseline gap-1.5"><span className="text-[34px] font-bold leading-[1.05] tabular-nums tracking-[-0.02em] text-oms-ok">{fmtNum(maxAvail)}</span><span className="text-[14px] font-semibold text-oms-ink-3">{currencyLabel(cur, locale)}</span></div>
        <div className="mt-1 text-[12px] text-oms-ink-2">{t("availableSub")}</div>
        {summary && (
          <dl className="mt-3 divide-y divide-oms-border text-[13px]">
            <Eq k={t("eqSettled")} v={moneySigned(summary.settled_lifetime, cur, locale, 2)} />
            {summary.corrections !== 0 && <Eq k={t("eqCorrections")} v={moneySigned(summary.corrections, cur, locale, 2)} />}
            <Eq k={t("eqWithdrawn")} v={moneySigned(-summary.withdrawn, cur, locale, 2)} />
            {summary.open_claims > 0 && <Eq k={t("eqOpen")} v={moneySigned(-summary.open_claims, cur, locale, 2)} />}
            <Eq k={t("eqAvailable")} v={money(summary.available_for_request, cur, locale, 2)} bold />
          </dl>
        )}
      </section>
      <section className="rounded-[10px] border border-oms-border bg-oms-surface p-3.5">
        <label className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-oms-ink-3" htmlFor="wd-amount">{t("amount")}</label>
        <input id="wd-amount" inputMode="decimal" value={amount === "" ? fmtNum(maxAvail, 2) : amount} onChange={(e) => setAmount(e.target.value)} className="mt-1.5 h-11 w-full rounded-lg border border-oms-border-strong bg-oms-surface px-3 text-[20px] font-bold tabular-nums" />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("note")} className="mt-2 h-9 w-full rounded-lg border border-oms-border bg-oms-surface px-3 text-[13px]" />
        <div className="mt-2.5 flex gap-2">
          <button type="button" onClick={() => setAmount("")} className="h-9 flex-1 rounded-lg border border-oms-border-strong bg-oms-surface text-[13px] font-semibold">{t("all")}</button>
          <button type="button" onClick={submit} disabled={busy || !(value > 0) || value > maxAvail + 1e-9} className="h-9 flex-[2] rounded-lg bg-oms-ink-1 text-[13px] font-semibold text-white disabled:opacity-40">{t("request")}</button>
        </div>
        {msg && <div className={`mt-2 rounded-lg px-2.5 py-2 text-[12px] ${msg.kind === "ok" ? "bg-oms-ok-bg text-oms-ok" : "bg-oms-bad-bg text-oms-age-late"}`}>{msg.text}</div>}
      </section>
      <div className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-oms-ink-3">{t("history")}</div>
      <section className="rounded-[10px] border border-oms-border bg-oms-surface px-3.5 py-0.5">
        {data && data.data.length === 0 && <div className="py-6 text-center text-[12.5px] text-oms-ink-3">{t("noHistory")}</div>}
        <ul className="m-0 list-none p-0">
          {(data?.data ?? []).map((w) => {
            const [cls, label] = st(w.status);
            return (
              <li key={w.id} className="flex items-start gap-2.5 border-t border-oms-border py-2.5 first:border-t-0">
                <span className="grid h-[30px] w-[30px] flex-none place-items-center rounded-full bg-oms-bad-bg text-oms-age-late"><ArrowUp size={15} /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[13px] font-semibold">{money(Number(w.amount), w.currency, locale, 2)} <span className={`inline-flex h-5 items-center rounded-full px-2 text-[10.5px] font-semibold ${cls}`}>{label}</span></span>
                  <span className="mt-0.5 flex flex-wrap gap-x-1.5 text-[11px] text-oms-ink-3">
                    <span>{t("requested")} <b className="font-semibold text-oms-ink-1">{dateShort(w.requested_at.slice(0, 10), locale)}</b></span>
                    {w.decided_at && <><span className="text-oms-border-strong">→</span><span>{w.status === "rejected" ? t("rejected") : t("approved")} <b className="font-semibold text-oms-ink-1">{dateShort(w.decided_at.slice(0, 10), locale)}</b></span></>}
                    {w.paid_at && <><span className="text-oms-border-strong">→</span><span>{t("paid")} <b className="font-semibold text-oms-ink-1">{dateShort(w.paid_at.slice(0, 10), locale)}</b>{w.payout_reference ? ` · ${t("reference", { ref: w.payout_reference })}` : ""}</span></>}
                  </span>
                  {w.admin_note && <span className="block text-[11px] text-oms-ink-3">{w.admin_note}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
function Eq({ k, v, bold = false }: { k: string; v: string; bold?: boolean }) {
  return <div className={`flex justify-between py-2 ${bold ? "font-bold" : ""}`}><dt className={bold ? "" : "text-oms-ink-2"}>{k}</dt><dd className="m-0 tabular-nums">{v}</dd></div>;
}
