"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import type { DealAccrualResult } from "@/lib/investors/accrual";
import type { TermsVersion } from "@/lib/investors/terms";
import type { StatementDraft } from "@/lib/investors/settlement";
import { dateLong, dateShort, fmtNum, money, pct } from "@/lib/investors/ui-format";
import { Btn, Callout, Card, Eq, Field, inputCls, Label, Money, Tag, td, tdL, th, thL, Waterfall3 } from "./admin-shared";
import type { AdminTab } from "./AdminInvestorsClient";

type DealRow = { id: string; investor_id: string; product_id: string; market_id: string; currency: string; label: string | null; start_date: string; end_date: string; status: string; products: { name: string; image_url: string | null } | null; investors: { legal_name: string | null } | null; investor_deal_snapshots: { as_of: string; cumulative_share: string; unsettled_share: string; payable_now: string; carried_loss_after: string; counts: Record<string, number>; rates: Record<string, number | null>; in_flight: { count: number }; pending: { count: number }; excluded: Record<string, number>; totals: { netProfit: number } } | null; terms_current: { effective_from: string; share_pct: number; capital_amount: number; payout_cadence: string; maturity_date: string; version: number } | null; settled_payable: number; statements_count: number; last_statement_end: string | null };
type Detail = { deal: DealRow & { note: string | null }; terms: TermsVersion[]; accrual: DealAccrualResult; statements: { id: string; sequence_no: number; period_start: string; period_end: string; payable: string; investor_share: string; kind: string }[]; today: string };
type Investor = { id: string; legal_name: string | null; full_name: string | null; email: string; configured: boolean; market_id: string | null };
type Product = { id: string; name: string; market_id: string; image_url: string | null };

const daysBetween = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000));

export function AdminDealsPanel({ locale, go, initialDealId, initialInvestorId }: { locale: string; go: (t: AdminTab, c?: { investorId?: string; dealId?: string }) => void; initialDealId?: string; initialInvestorId?: string }) {
  const t = useTranslations("investorAdmin.deals");
  const tc = useTranslations("investorAdmin.common");
  const { data, mutate } = useSWR<{ data: DealRow[] }>("/api/admin/investments/deals", fetcher);
  const deals = data?.data ?? [];
  const [sel, setSel] = useState<string | null>(initialDealId ?? null);
  const [showForm, setShowForm] = useState(!!initialInvestorId);
  useEffect(() => { if (!sel && deals.length) setSel(deals[0].id); }, [deals, sel]);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex justify-end"><Btn variant="primary" onClick={() => setShowForm((s) => !s)}>{t("newDeal")}</Btn></div>
      {showForm && <NewDealForm locale={locale} initialInvestorId={initialInvestorId} onCreated={(id) => { setShowForm(false); mutate(); setSel(id); }} />}
      <Card pad={false}>
        <table className="w-full border-collapse text-[12.5px]"><thead><tr><th className={thL}>{t("colDeal")}</th><th className={thL}>{t("colTerms")}</th><th className={thL}>{t("colDuration")}</th><th className={th}>{t("colFunnel")}</th><th className={th}>{t("colNet")}</th><th className={th}>{t("colShare")}</th><th className={th}>{t("colSettled")}</th><th className={th}>{t("colUnsettled")}</th><th className={thL}>{t("colState")}</th></tr></thead>
          <tbody>{deals.map((d) => {
            const s = d.investor_deal_snapshots; const c = s?.counts ?? {}; const total = daysBetween(d.start_date, d.end_date); const el = Math.min(total, daysBetween(d.start_date, today));
            return (
              <tr key={d.id} onClick={() => setSel(d.id)} className={`cursor-pointer ${sel === d.id ? "bg-oms-sunken" : "hover:bg-oms-sunken/60"}`}>
                <td className={tdL}>{d.products?.image_url && <img src={d.products.image_url} alt="" className="me-2 inline-block h-[30px] w-[30px] rounded-md object-cover align-middle" />}{d.products?.name}<span className="block text-[11px] text-oms-ink-3">{d.investors?.legal_name ?? "—"} · {d.currency}</span></td>
                <td className={tdL}><b>{d.terms_current ? `${fmtNum(d.terms_current.share_pct)} %` : "—"}</b> · {d.terms_current ? money(d.terms_current.capital_amount, d.currency, locale) : ""}<span className="block text-[11px] text-oms-ink-3">{d.terms_current ? t("versioned", { cadence: t(`cadence.${d.terms_current.payout_cadence}`), n: d.terms_current.version }) : ""}</span></td>
                <td className={tdL}><span className="inline-block h-1 w-[90px] overflow-hidden rounded bg-oms-sunken align-middle"><i className="block h-full bg-oms-ink-2" style={{ width: `${total ? (el / total) * 100 : 0}%` }} /></span><span className="block text-[11px] text-oms-ink-3">{t("dayOf", { n: el, total, date: dateLong(d.end_date, locale) })}</span></td>
                <td className={td}>{fmtNum(c.received ?? 0)} → {fmtNum(c.uploaded ?? 0)} → {fmtNum(c.delivered ?? 0)}<span className="block text-[11px] text-oms-ink-3">{pct(s?.rates?.confirmed ?? null, 0)} · {pct(s?.rates?.delivered ?? null, 0)}</span></td>
                <td className={td}><Money v={s?.totals?.netProfit ?? 0} dir={false} className={(s?.totals?.netProfit ?? 0) < 0 ? "text-oms-age-late" : ""} /></td>
                <td className={td}><Money v={Number(s?.cumulative_share ?? 0)} /></td>
                <td className={td}>{fmtNum(d.settled_payable)}</td>
                <td className={`${td} text-oms-ink-2`}>{fmtNum(Number(s?.payable_now ?? 0))}</td>
                <td className={tdL}><span className="flex flex-wrap gap-1">{Number(s?.carried_loss_after ?? 0) > 0 && <Tag tone="warn">{tc("carried").toLowerCase()} {fmtNum(Number(s!.carried_loss_after))}</Tag>}{(s?.excluded?.dexpress ?? 0) > 0 && <Tag tone="warn">{tc("dexpressExcluded", { n: s!.excluded.dexpress })}</Tag>}{(s?.in_flight?.count ?? 0) > 0 && <Tag>{tc("inFlight", { n: s!.in_flight.count })}</Tag>}{d.status !== "active" && <Tag>{tc(d.status as "matured")}</Tag>}{d.status === "active" && !Number(s?.carried_loss_after ?? 0) && !(s?.in_flight?.count ?? 0) && <Tag tone="ok">{tc("healthy")}</Tag>}</span></td>
              </tr>
            );
          })}</tbody></table>
      </Card>
      {sel && <DealDetail dealId={sel} locale={locale} onChanged={() => mutate()} go={go} />}
    </div>
  );
}

function DealDetail({ dealId, locale, onChanged, go }: { dealId: string; locale: string; onChanged: () => void; go: (t: AdminTab, c?: { investorId?: string; dealId?: string }) => void }) {
  const t = useTranslations("investorAdmin.deals");
  const tc = useTranslations("investorAdmin.common");
  const tt = useTranslations("investorAdmin.tabs");
  const { data, mutate } = useSWR<{ data: Detail }>(`/api/admin/investments/deals/${dealId}`, fetcher);
  const [mode, setMode] = useState<"none" | "amend" | "close">("none");
  const d = data?.data;
  if (!d) return <Card><div className="py-6 text-center text-[12.5px] text-oms-ink-3">{tc("loading")}</div></Card>;
  const a = d.accrual; const cur = d.deal.currency; const share = a.sharePctToday;
  const currentTerms = d.terms[d.terms.length - 1];
  return (
    <Card>
      <div className="flex items-center gap-3.5">
        {d.deal.products?.image_url && <img src={d.deal.products.image_url} alt="" className="h-14 w-14 rounded-[10px] border border-oms-border object-cover" />}
        <div className="flex-1">
          <div className="text-[16px] font-semibold">{d.deal.products?.name} <Tag tone={d.deal.status === "active" ? "ok" : "neutral"}>{tc(d.deal.status as "active")}</Tag></div>
          <div className="text-[11.5px] text-oms-ink-3">{d.deal.investors?.legal_name} · {fmtNum(share)} % · {currentTerms ? money(currentTerms.capitalAmount, cur, locale) : ""} · {dateShort(d.deal.start_date, locale)} → {dateLong(d.deal.end_date, locale)} · {currentTerms ? t(`cadence.${currentTerms.payoutCadence}`) : ""} · {t("cohortNote")}</div>
        </div>
        <div className="flex gap-2">
          <Btn onClick={() => setMode(mode === "amend" ? "none" : "amend")} disabled={d.deal.status === "closed"}>{t("amendTerms")}</Btn>
          <Btn onClick={() => setMode(mode === "close" ? "none" : "close")} disabled={d.deal.status === "closed"}>{d.deal.status === "matured" ? t("closeAtMaturity") : t("earlyExit")}</Btn>
          <Btn variant="primary" onClick={() => go("close", { investorId: d.deal.investor_id })}>{tt("close")}</Btn>
        </div>
      </div>
      {mode === "amend" && <AmendForm deal={d} onDone={() => { setMode("none"); mutate(); onChanged(); }} />}
      {mode === "close" && <CloseForm deal={d} locale={locale} onDone={() => { setMode("none"); mutate(); onChanged(); }} />}
      <div className="mt-3.5 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
        <div>
          <Label className="mb-1.5">{t("detailTitle")}</Label>
          <Waterfall3 w={a.totals} sharePct={share} counts={{ dc: a.counts.delivered, rc: a.counts.returned }} perUnit={a.totals.perUnit as Record<string, number | null>} carried={a.carriedLossAfter} />
          <div className="mt-2 text-[11.5px] text-oms-ink-3">{a.counts.excludedDexpress > 0 && <b className="font-semibold text-oms-ink-2">{tc("dexpressExcluded", { n: a.counts.excludedDexpress })} · </b>}{tc("inFlight", { n: a.counts.inFlight })} · {a.pending.count > 0 ? tc("pending", { n: a.pending.count }) : ""}</div>
        </div>
        <div>
          <Label className="mb-2">{t("termsHistory")}</Label>
          <ol className="m-0 list-none space-y-3 border-s-2 border-oms-border ps-4">
            {[...d.terms].reverse().map((v, i) => <li key={v.id ?? v.effectiveFrom}><b className="block text-[12.5px] font-semibold">{i === 0 ? t("inForce", { n: d.terms.length }) : `v${d.terms.length - i}`}</b><span className="text-[11.5px] text-oms-ink-3">{t("termsDesc", { date: dateShort(v.effectiveFrom, locale), pct: fmtNum(v.sharePct), capital: money(v.capitalAmount, cur, locale), cadence: t(`cadence.${v.payoutCadence}`), maturity: dateLong(v.maturityDate, locale) })}</span></li>)}
          </ol>
          <Label className="mb-2 mt-3">{t("statements")}</Label>
          <Eq rows={[...d.statements.map((s) => ({ k: t("statementRow", { n: s.sequence_no, start: dateShort(s.period_start, locale), end: dateShort(s.period_end, locale) }), v: <Money v={Number(s.payable)} dp={2} dir={false} /> })), { k: `${tc("today")} · ${dateShort(d.today, locale)}`, v: <span className="text-oms-ink-2">{fmtNum(a.payableNow, 2)}</span> }]} />
        </div>
      </div>
    </Card>
  );
}

function AmendForm({ deal, onDone }: { deal: Detail; onDone: () => void }) {
  const t = useTranslations("investorAdmin.deals.amend");
  const td2 = useTranslations("investorAdmin.deals");
  const tc = useTranslations("investorAdmin.common");
  const cur = deal.terms[deal.terms.length - 1];
  const [eff, setEff] = useState(new Date().toISOString().slice(0, 10));
  const [share, setShare] = useState(String(cur?.sharePct ?? 30));
  const [capital, setCapital] = useState(String(cur?.capitalAmount ?? 0));
  const [cad, setCad] = useState(cur?.payoutCadence ?? "quarterly");
  const [mat, setMat] = useState(cur?.maturityDate ?? deal.deal.end_date);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function apply() {
    setBusy(true); setErr(null);
    const r = await fetch(`/api/admin/investments/deals/${deal.deal.id}/terms`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ effective_from: eff, share_pct: Number(share), capital_amount: Number(capital), payout_cadence: cad, maturity_date: mat, note }) });
    setBusy(false);
    if (r.ok) onDone(); else { const j = await r.json().catch(() => ({})); setErr(j.code ?? j.error ?? tc("error")); }
  }
  return (
    <div className="mt-3 rounded-lg border border-oms-border bg-oms-sunken p-3">
      <Label className="mb-2">{t("title")}</Label>
      <div className="grid grid-cols-5 gap-3">
        <Field label={t("effectiveFrom")}><input type="date" className={inputCls} value={eff} onChange={(e) => setEff(e.target.value)} /></Field>
        <Field label={td2("form.share")}><input className={inputCls} value={share} onChange={(e) => setShare(e.target.value)} /></Field>
        <Field label={td2("form.capital")}><input className={inputCls} value={capital} onChange={(e) => setCapital(e.target.value)} /></Field>
        <Field label={td2("form.cadence")}><select className={inputCls} value={cad} onChange={(e) => setCad(e.target.value as typeof cad)}>{["monthly", "quarterly", "semiannual", "annual", "at_maturity"].map((c) => <option key={c} value={c}>{td2(`cadence.${c}`)}</option>)}</select></Field>
        <Field label={t("maturity")}><input type="date" className={inputCls} value={mat} onChange={(e) => setMat(e.target.value)} /></Field>
      </div>
      <div className="mt-2"><input className={inputCls} placeholder={td2("form.note")} value={note} onChange={(e) => setNote(e.target.value)} /></div>
      <div className="mt-2 text-[11.5px] text-oms-ink-3">{t("hint")}</div>
      {err && <div className="mt-2"><Callout tone="bad">{err}</Callout></div>}
      <div className="mt-2 flex justify-end gap-2"><Btn onClick={onDone}>{tc("cancel")}</Btn><Btn variant="primary" onClick={apply} disabled={busy}>{t("apply")}</Btn></div>
    </div>
  );
}

function CloseForm({ deal, locale, onDone }: { deal: Detail; locale: string; onDone: () => void }) {
  const t = useTranslations("investorAdmin.deals.close");
  const tc = useTranslations("investorAdmin.common");
  const cur = deal.terms[deal.terms.length - 1];
  const [reason, setReason] = useState<"maturity" | "early_exit">(deal.deal.status === "matured" ? "maturity" : "early_exit");
  const [exitDate, setExitDate] = useState(deal.today);
  const [periodEnd, setPeriodEnd] = useState(deal.today);
  const [draft, setDraft] = useState<StatementDraft | null>(null);
  const [typed, setTyped] = useState("");
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  async function preview() {
    setBusy(true); setErr(null);
    // Early exit: set the exit date first so the preview reflects the shortened cohort.
    if (reason === "early_exit" && exitDate < deal.deal.end_date) {
      const r0 = await fetch(`/api/admin/investments/deals/${deal.deal.id}/close`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason, exit_date: exitDate }) });
      if (!r0.ok) { const j = await r0.json().catch(() => ({})); setErr(j.code ?? j.error ?? tc("error")); setBusy(false); return; }
    }
    const r = await fetch(`/api/admin/investments/deals/${deal.deal.id}/close/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ period_end: periodEnd }) });
    setBusy(false);
    if (r.ok) setDraft((await r.json()).data); else { const j = await r.json().catch(() => ({})); setErr(j.code ?? j.error ?? tc("error")); }
  }
  async function confirm() {
    if (!draft) return; setBusy(true); setErr(null);
    const r = await fetch(`/api/admin/investments/deals/${deal.deal.id}/close`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason, period_end: periodEnd, preview_hash: draft.preview_hash }) });
    setBusy(false);
    if (r.ok) onDone(); else { const j = await r.json().catch(() => ({})); setErr(j.code ?? j.error ?? tc("error")); if (j.code === "PREVIEW_STALE") setDraft(null); }
  }
  return (
    <div className="mt-3 rounded-lg border border-oms-border bg-oms-sunken p-3">
      <Label className="mb-2">{t("title")}</Label>
      <div className="grid grid-cols-4 gap-3">
        <Field label={t("reason")}><select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value as "maturity")}><option value="maturity">{t("maturity")}</option><option value="early_exit">{t("earlyExit")}</option></select></Field>
        {reason === "early_exit" && <Field label={t("exitDate")}><input type="date" className={inputCls} value={exitDate} onChange={(e) => setExitDate(e.target.value)} /></Field>}
        <Field label={t("periodEnd")}><input type="date" className={inputCls} value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} /></Field>
        <div className="flex items-end"><Btn onClick={preview} disabled={busy}>{t("preview")}</Btn></div>
      </div>
      <div className="mt-2"><Callout tone="warn">{t("hint", { amount: money(cur?.capitalAmount ?? 0, deal.deal.currency, locale) })}</Callout></div>
      {draft && (
        <div className="mt-3">
          <Waterfall3 w={{ revenue: draft.revenue, cogs: draft.cogs, deliveryCost: draft.delivery_cost, returnCost: draft.return_cost, packingCost: draft.packing_cost, processingCost: draft.processing_cost, adSpend: draft.ad_spend_direct, grossProfit: draft.gross_profit, netProfit: draft.net_profit }} sharePct={draft.share_pct_max} carried={draft.carried_loss_after} />
          <div className="mt-2 flex flex-wrap gap-1">{draft.warnings.map((w) => <Tag key={w.code} tone={w.code === "NEGATIVE_PERIOD" ? "bad" : w.code === "DEXPRESS_EXCLUDED" || w.code === "PENDING_ORDERS" ? "warn" : "neutral"}>{w.code}{w.count ? ` ${w.count}` : ""}</Tag>)}</div>
          <div className="mt-2 flex items-center justify-end gap-2"><input className={`${inputCls} w-64`} placeholder={tc("typeToConfirm", { word: tc("word") })} value={typed} onChange={(e) => setTyped(e.target.value)} /><Btn variant="destructive" onClick={confirm} disabled={busy || typed.trim().toUpperCase() !== tc("word")}>{t("confirm")}</Btn></div>
        </div>
      )}
      {err && <div className="mt-2"><Callout tone="bad">{err}</Callout></div>}
    </div>
  );
}

function NewDealForm({ locale, initialInvestorId, onCreated }: { locale: string; initialInvestorId?: string; onCreated: (id: string) => void }) {
  const t = useTranslations("investorAdmin.deals.form");
  const td2 = useTranslations("investorAdmin.deals");
  const tc = useTranslations("investorAdmin.common");
  const { data: inv } = useSWR<{ data: Investor[] }>("/api/admin/investments/investors", fetcher);
  const { data: prods } = useSWR<{ data: Product[] }>("/api/products", fetcher);
  const investors = (inv?.data ?? []).filter((i) => i.configured);
  const [investorId, setInvestorId] = useState(initialInvestorId ?? "");
  const [productId, setProductId] = useState("");
  const [share, setShare] = useState("30");
  const [capital, setCapital] = useState("10000");
  const [start, setStart] = useState(new Date().toISOString().slice(0, 10));
  const [months, setMonths] = useState("12");
  const [cad, setCad] = useState("quarterly");
  const [label, setLabel] = useState(""); const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const investorMarket = investors.find((i) => i.id === investorId)?.market_id ?? null;
  const products = useMemo(() => (prods?.data ?? []).filter((p) => !investorMarket || p.market_id === investorMarket), [prods, investorMarket]);
  const end = useMemo(() => { const d = new Date(start + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() + Number(months || 0)); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }, [start, months]);
  async function create() {
    setBusy(true); setErr(null);
    const r = await fetch("/api/admin/investments/deals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ investor_id: investorId, product_id: productId, start_date: start, term_months: Number(months), share_pct: Number(share), capital_amount: Number(capital), payout_cadence: cad, label: label || null, note: note || null }) });
    setBusy(false);
    if (r.ok) onCreated((await r.json()).data.id); else { const j = await r.json().catch(() => ({})); setErr(j.code ?? j.error ?? tc("error")); }
  }
  return (
    <Card>
      <Label className="mb-2.5">{t("title")}</Label>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("investor")}><select className={inputCls} value={investorId} onChange={(e) => setInvestorId(e.target.value)}><option value="">{t("chooseInvestor")}</option>{investors.map((i) => <option key={i.id} value={i.id}>{i.legal_name ?? i.full_name ?? i.email}</option>)}</select></Field>
        <Field label={t("product")} hint={t("productHint")}><select className={inputCls} value={productId} onChange={(e) => setProductId(e.target.value)}><option value="">{t("chooseProduct")}</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label={t("share")}><input className={inputCls} value={share} onChange={(e) => setShare(e.target.value)} /></Field>
        <Field label={t("capital")} hint={t("capitalHint")}><input className={inputCls} value={capital} onChange={(e) => setCapital(e.target.value)} /></Field>
        <Field label={t("start")}><input type="date" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label={t("term")} hint={`${t("termHint")} → ${dateLong(end, locale)}`}><input className={inputCls} value={months} onChange={(e) => setMonths(e.target.value)} /></Field>
        <Field label={t("cadence")} hint={t("cadenceHint")}><select className={inputCls} value={cad} onChange={(e) => setCad(e.target.value)}>{["monthly", "quarterly", "semiannual", "annual", "at_maturity"].map((c) => <option key={c} value={c}>{td2(`cadence.${c}`)}</option>)}</select></Field>
        <Field label={t("label")}><input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
        <div className="col-span-2"><Field label={t("note")}><textarea className={`${inputCls} h-16 py-2`} value={note} onChange={(e) => setNote(e.target.value)} /></Field></div>
      </div>
      {err && <div className="mt-2"><Callout tone="bad">{err}</Callout></div>}
      <div className="mt-3 flex justify-end gap-2"><Btn variant="primary" onClick={create} disabled={busy || !investorId || !productId}>{t("create")}</Btn></div>
    </Card>
  );
}
