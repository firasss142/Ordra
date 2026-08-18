"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import type { StatementDraft } from "@/lib/investors/settlement";
import { dateShort, dateTimeShort, fmtNum, fmtSigned, money } from "@/lib/investors/ui-format";
import { Btn, Callout, Card, Field, inputCls, Label, Money, Tag, td, tdL, th, thL, Waterfall3 } from "./admin-shared";

type Draft = StatementDraft & { investor_id: string; currency: string; product_name: string | null; image_url: string | null; investor_name: string | null; error?: string };
type Investor = { id: string; legal_name: string | null; full_name: string | null; email: string; configured: boolean; money: { deals_active: number } | null };
type Settled = { id: string; deal_id: string; sequence_no: number; period_start: string; period_end: string; net_profit: string; investor_share: string; payable: string; carried_loss_after: string; settled_at: string; currency: string; investor_deals: { products: { name: string; image_url: string | null } | null } | null; investors: { legal_name: string | null } | null };

export function AdminClosePanel({ locale, initialInvestorId }: { locale: string; initialInvestorId?: string }) {
  const t = useTranslations("investorAdmin.close");
  const tc = useTranslations("investorAdmin.common");
  const { data: inv } = useSWR<{ data: Investor[] }>("/api/admin/investments/investors", fetcher);
  const { data: settled, mutate: mutSettled } = useSWR<{ data: Settled[] }>("/api/admin/investments/settlements", fetcher);
  const investors = (inv?.data ?? []).filter((i) => i.configured && (i.money?.deals_active ?? 0) > 0);
  const [investorId, setInvestorId] = useState(initialInvestorId ?? "");
  const [periodEnd, setPeriodEnd] = useState(new Date().toISOString().slice(0, 10));
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "bad" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function preview() {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/admin/investments/settlements/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ investor_id: investorId, period_end: periodEnd }) });
    setBusy(false);
    if (r.ok) { const j = await r.json(); setDrafts(j.data); setSel(j.data[0]?.deal_id ?? null); } else { const j = await r.json().catch(() => ({})); setMsg({ tone: "bad", text: j.error ?? tc("error") }); }
  }
  async function commit() {
    if (!drafts) return; setBusy(true); setMsg(null);
    const ok = drafts.filter((d) => !d.error);
    const r = await fetch("/api/admin/investments/settlements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ drafts: ok.map((d) => ({ deal_id: d.deal_id, period_end: d.period_end, preview_hash: d.preview_hash })) }) });
    setBusy(false);
    if (r.ok) { setMsg({ tone: "ok", text: t("done", { n: ok.length }) }); setDrafts(null); setTyped(""); mutSettled(); }
    else { const j = await r.json().catch(() => ({})); if (j.code === "PREVIEW_STALE") { setMsg({ tone: "warn", text: t("stale") }); preview(); } else setMsg({ tone: "bad", text: j.error ?? tc("error") }); }
  }
  const valid = (drafts ?? []).filter((d) => !d.error);
  const total = valid.reduce((a, d) => a + d.payable, 0);
  const cur = valid[0]?.currency ?? "";
  const selected = drafts?.find((d) => d.deal_id === sel) ?? null;
  const warnTone = (code: string) => (code === "NEGATIVE_PERIOD" ? "bad" : code === "DEXPRESS_EXCLUDED" || code === "PENDING_ORDERS" || code === "RESTATEMENT" ? "warn" : "neutral");
  return (
    <div className="flex flex-col gap-3.5">
      <Card>
        <div className="grid grid-cols-[260px_200px_auto_1fr] items-end gap-3">
          <Field label={t("investorOrDeals")}><select className={inputCls} value={investorId} onChange={(e) => setInvestorId(e.target.value)}><option value="">—</option>{investors.map((i) => <option key={i.id} value={i.id}>{i.legal_name ?? i.full_name ?? i.email} · {i.money?.deals_active}</option>)}</select></Field>
          <Field label={t("periodEnd")}><input type="date" className={inputCls} value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} /></Field>
          <Btn onClick={preview} disabled={busy || !investorId}>{t("preview")}</Btn>
          <div className="text-[11.5px] text-oms-ink-3">{t("derivedStart")}</div>
        </div>
      </Card>
      {msg && <Callout tone={msg.tone === "ok" ? "info" : msg.tone}>{msg.text}</Callout>}
      {!drafts && !msg && <Callout>{t("selectFirst")}</Callout>}
      {drafts && (
        <>
          <Card pad={false}>
            <table className="w-full border-collapse text-[12.5px]"><thead><tr><th className={thL}>{t("colDeal")}</th><th className={thL}>{t("colPeriod")}</th><th className={th}>{t("colNet")}</th><th className={th}>{t("colShare")}</th><th className={th}>{t("colRestatement")}</th><th className={th}>{t("colCarriedBefore")}</th><th className={th}>{t("colPayable")}</th><th className={th}>{t("colCarriedAfter")}</th><th className={thL}>{t("colWarnings")}</th></tr></thead>
              <tbody>
                {drafts.map((d) => (
                  <tr key={d.deal_id} onClick={() => setSel(d.deal_id)} className={`cursor-pointer ${sel === d.deal_id ? "bg-oms-sunken" : ""}`}>
                    <td className={tdL}>{d.image_url && <img src={d.image_url} alt="" className="me-2 inline-block h-7 w-7 rounded-md object-cover align-middle" />}{d.product_name}<span className="block text-[11px] text-oms-ink-3">{d.investor_name} · {fmtNum(d.share_pct_max)} %</span></td>
                    <td className={tdL}>{dateShort(d.period_start, locale)} → {dateShort(d.period_end, locale)}</td>
                    <td className={td}><Money v={d.net_profit} dp={2} dir={false} className={d.net_profit < 0 ? "text-oms-age-late" : ""} /></td>
                    <td className={td}><Money v={d.investor_share} dp={2} /></td>
                    <td className={td}>{fmtSigned(d.restatement_delta, 2)}</td>
                    <td className={td}>{d.carried_loss_before ? <span className="text-oms-age-late">−{fmtNum(d.carried_loss_before, 2)}</span> : "—"}</td>
                    <td className={td}><b className={d.payable > 0 ? "text-oms-ok" : ""}>{fmtNum(d.payable, 2)}</b></td>
                    <td className={td}>{d.carried_loss_after ? <span className="text-oms-age-late">−{fmtNum(d.carried_loss_after, 2)}</span> : "—"}</td>
                    <td className={tdL}><span className="flex flex-wrap gap-1">{d.error ? <Tag tone="bad">{d.error}</Tag> : d.warnings.map((w) => <Tag key={w.code} tone={warnTone(w.code)}>{w.code === "IN_FLIGHT" ? tc("inFlight", { n: w.count ?? 0 }) : w.code === "DEXPRESS_EXCLUDED" ? tc("dexpressExcluded", { n: w.count ?? 0 }) : w.code === "PENDING_ORDERS" ? tc("pending", { n: w.count ?? 0 }) : w.code === "NEGATIVE_PERIOD" ? tc("negative") : w.code === "NO_MOVEMENT" ? tc("noMovement") : tc("restatement")}</Tag>)}</span></td>
                  </tr>
                ))}
                <tr className="bg-oms-sunken font-bold"><td className={tdL} colSpan={6}>{t("total", { n: valid.length })}</td><td className={td}>{money(total, cur, locale, 2)}</td><td className={td} colSpan={2} /></tr>
              </tbody></table>
          </Card>
          {selected && !selected.error && (
            <Card>
              <Label className="mb-1.5">{t("detail", { name: selected.product_name ?? "", start: dateShort(selected.period_start, locale), end: dateShort(selected.period_end, locale) })}</Label>
              <Waterfall3 w={{ revenue: selected.revenue, cogs: selected.cogs, deliveryCost: selected.delivery_cost, returnCost: selected.return_cost, packingCost: selected.packing_cost, processingCost: selected.processing_cost, adSpend: selected.ad_spend_direct, grossProfit: selected.gross_profit, netProfit: selected.net_profit }} sharePct={selected.share_pct_max} carried={selected.carried_loss_after} />
              {selected.investor_share > 0 && selected.carried_loss_before > 0 && selected.payable === 0 && <div className="mt-2.5"><Callout tone="warn">{t("recovering", { share: fmtSigned(selected.investor_share, 2), carried: fmtNum(selected.carried_loss_before, 2), after: fmtNum(selected.carried_loss_after, 2) })}</Callout></div>}
            </Card>
          )}
          <Card>
            <div className="mb-2.5 text-[11.5px] text-oms-ink-3"><b className="font-semibold text-oms-ink-2">{tc("irreversible")}</b> : {t("confirmNote", { n: valid.length, amount: money(total, cur, locale, 2) })}</div>
            <div className="flex items-center justify-end gap-2.5"><input className={`${inputCls} w-72`} placeholder={tc("typeToConfirm", { word: tc("word") })} value={typed} onChange={(e) => setTyped(e.target.value)} /><Btn variant="destructive" onClick={commit} disabled={busy || !valid.length || typed.trim().toUpperCase() !== tc("word")}>{t("confirm")}</Btn></div>
          </Card>
        </>
      )}
      <Card pad={false}>
        <div className="px-3.5 pb-1 pt-3"><Label>{t("settledTitle")}</Label></div>
        <table className="w-full border-collapse text-[12.5px]"><thead><tr><th className={thL}>{t("colDeal")}</th><th className={thL}>{t("colPeriod")}</th><th className={th}>{t("colNet")}</th><th className={th}>{t("colShare")}</th><th className={th}>{t("colPayable")}</th><th className={thL}>{t("settledOnCol")}</th></tr></thead>
          <tbody>{(settled?.data ?? []).map((s) => (
            <tr key={s.id}><td className={tdL}>{s.investor_deals?.products?.image_url && <img src={s.investor_deals.products.image_url} alt="" className="me-2 inline-block h-7 w-7 rounded-md object-cover align-middle" />}{t("statementNo", { n: s.sequence_no })} · {s.investor_deals?.products?.name}<span className="block text-[11px] text-oms-ink-3">{s.investors?.legal_name}</span></td><td className={tdL}>{dateShort(s.period_start, locale)} → {dateShort(s.period_end, locale)}</td><td className={td}><Money v={Number(s.net_profit)} dp={2} dir={false} className={Number(s.net_profit) < 0 ? "text-oms-age-late" : ""} /></td><td className={td}><Money v={Number(s.investor_share)} dp={2} /></td><td className={td}><b>{fmtNum(Number(s.payable), 2)}</b>{Number(s.carried_loss_after) > 0 && <span className="block text-[11px] text-oms-age-late">{tc("carried").toLowerCase()} {fmtNum(Number(s.carried_loss_after), 2)}</span>}</td><td className={tdL}>{dateTimeShort(s.settled_at, locale)}</td></tr>
          ))}</tbody></table>
      </Card>
    </div>
  );
}
