"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import type { InvestorMoneySummary } from "@/lib/investors/admin-summary";
import { dateTimeShort, fmtNum, money, moneySigned } from "@/lib/investors/ui-format";
import { Btn, Callout, Card, Eq, Field, inputCls, Label, td, tdL, th, thL } from "./admin-shared";

type Investor = { id: string; legal_name: string | null; full_name: string | null; email: string; configured: boolean; money: InvestorMoneySummary | null };
type Deal = { id: string; investor_id: string; products: { name: string } | null; currency: string };
type Corr = { id: string; investor_id: string; amount: string; currency: string; note: string | null; created_at: string; investors: { legal_name: string | null } | null; investor_deals: { products: { name: string } | null } | null; users: { email: string } | null };

export function AdminCorrectionsPanel({ locale, initialInvestorId }: { locale: string; initialInvestorId?: string }) {
  const t = useTranslations("investorAdmin.corrections");
  const tc = useTranslations("investorAdmin.common");
  const { data: inv } = useSWR<{ data: Investor[] }>("/api/admin/investments/investors", fetcher);
  const { data: deals } = useSWR<{ data: Deal[] }>("/api/admin/investments/deals", fetcher);
  const { data: hist, mutate } = useSWR<{ data: Corr[] }>("/api/admin/investments/corrections", fetcher);
  const investors = (inv?.data ?? []).filter((i) => i.configured);
  const [investorId, setInvestorId] = useState(initialInvestorId ?? "");
  const [dealId, setDealId] = useState(""); const [amount, setAmount] = useState(""); const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null); const [confirm, setConfirm] = useState(false);
  const investor = investors.find((i) => i.id === investorId);
  const cur = investor ? Object.keys(investor.money?.by_currency ?? {})[0] : undefined;
  const before = investor && cur ? investor.money!.by_currency[cur].available : 0;
  const amt = Number(amount.replace(",", ".")) || 0;
  async function post() {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/admin/investments/corrections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ investor_id: investorId, amount: amt, note, deal_id: dealId || undefined }) });
    setBusy(false); setConfirm(false);
    if (r.ok) { setMsg({ tone: "ok", text: t("posted") }); setAmount(""); setNote(""); mutate(); } else { const j = await r.json().catch(() => ({})); setMsg({ tone: "bad", text: j.code ?? j.error ?? tc("error") }); }
  }
  return (
    <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[520px_1fr]">
      <Card>
        <Label className="mb-2.5">{t("title")}</Label>
        <Field label={t("investor")}><select className={inputCls} value={investorId} onChange={(e) => { setInvestorId(e.target.value); setDealId(""); }}><option value="">—</option>{investors.map((i) => <option key={i.id} value={i.id}>{i.legal_name ?? i.full_name ?? i.email}</option>)}</select></Field>
        <div className="mt-3"><Field label={t("deal")}><select className={inputCls} value={dealId} onChange={(e) => setDealId(e.target.value)}><option value="">{t("none")}</option>{(deals?.data ?? []).filter((d) => d.investor_id === investorId).map((d) => <option key={d.id} value={d.id}>{d.products?.name}</option>)}</select></Field></div>
        <div className="mt-3"><Field label={t("amount")} hint={t("amountHint")}><input className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="−67,26" /></Field></div>
        <div className="mt-3"><Field label={t("note")}><textarea className={`${inputCls} h-20 py-2`} value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>
        {investor && cur && <div className="mt-3"><Eq rows={[{ k: t("before"), v: money(before, cur, locale, 2) }, { k: t("correction"), v: <span className={amt < 0 ? "text-oms-age-late" : amt > 0 ? "text-oms-ok" : ""}>{moneySigned(amt, cur, locale, 2)}</span> }, { k: t("after"), v: money(before + amt, cur, locale, 2), tot: true }]} /></div>}
        <div className="mt-3"><Callout tone="warn">{t("warn")}</Callout></div>
        {msg && <div className="mt-2"><Callout tone={msg.tone === "ok" ? "info" : "bad"}>{msg.text}</Callout></div>}
        <div className="mt-3 flex justify-end gap-2">
          {!confirm ? <Btn variant="destructive" onClick={() => setConfirm(true)} disabled={!investorId || !amt || !note.trim()}>{t("post")}</Btn> : <><Btn onClick={() => setConfirm(false)}>{tc("cancel")}</Btn><Btn variant="destructive" onClick={post} disabled={busy}>{tc("confirm")} · {moneySigned(amt, cur, locale, 2)}</Btn></>}
        </div>
      </Card>
      <div className="flex flex-col gap-3.5">
        <Card pad={false}>
          <div className="px-3.5 pb-1 pt-3"><Label>{t("history")}</Label></div>
          <table className="w-full border-collapse text-[12.5px]"><thead><tr><th className={thL}>{t("colDate")}</th><th className={thL}>{t("colInvestor")}</th><th className={thL}>{t("colAttached")}</th><th className={th}>{t("colAmount")}</th><th className={thL}>{t("colNote")}</th><th className={thL}>{t("colBy")}</th></tr></thead>
            <tbody>{(hist?.data ?? []).length === 0 && <tr><td className={`${tdL} py-6 text-center text-oms-ink-3`} colSpan={6}>{t("empty")}</td></tr>}{(hist?.data ?? []).map((c) => <tr key={c.id}><td className={tdL}>{dateTimeShort(c.created_at, locale)}</td><td className={tdL}>{c.investors?.legal_name}</td><td className={tdL}>{c.investor_deals?.products?.name ?? "—"}</td><td className={td}><span className={Number(c.amount) < 0 ? "text-oms-age-late" : "text-oms-ok"}>{fmtNum(Number(c.amount), 2)}</span> {c.currency}</td><td className={tdL}>{c.note}</td><td className={tdL}>{c.users?.email}</td></tr>)}</tbody></table>
        </Card>
        <Card>
          <Label className="mb-2">{t("when")}</Label>
          <ul className="m-0 list-none p-0 text-[12.5px]">
            {(["w1", "w2", "w3"] as const).map((k) => <li key={k} className="border-t border-oms-border py-2 first:border-t-0"><b className="block font-semibold">{t(k)}</b><span className="text-oms-ink-3">{t(`${k}s`)}</span></li>)}
          </ul>
        </Card>
      </div>
    </div>
  );
}
