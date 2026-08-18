"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import type { InvestorMoneySummary } from "@/lib/investors/admin-summary";
import type { PortfolioPayload } from "@/lib/investors/portfolio-summary";
import { dateLong, dateShort, dateTimeShort, fmtNum, money, moneySigned, pct } from "@/lib/investors/ui-format";
import { Btn, Callout, Card, Field, inputCls, Label, Money, Tag, td, tdL, th, thL } from "./admin-shared";
import type { AdminTab } from "./AdminInvestorsClient";

type Inv = { id: string; email: string; full_name: string | null; market_id: string | null; is_active: boolean; configured: boolean; legal_name: string | null; payout_method: string | null; notes: string | null; money: InvestorMoneySummary | null };
type Ledger = { id: string; entry_type: string; amount: string | number; currency: string; note: string | null; created_at: string; investor_deals: { label: string | null; products: { name: string | null } | null } | null; users: { email: string } | null };

export function AdminInvestorsPanel({ locale, go, investorsHref }: { locale: string; go: (t: AdminTab, c?: { investorId?: string; dealId?: string }) => void; investorsHref: string }) {
  const t = useTranslations("investorAdmin.investors");
  const tc = useTranslations("investorAdmin.common");
  const { data, mutate } = useSWR<{ data: Inv[] }>("/api/admin/investments/investors", fetcher);
  const list = data?.data ?? [];
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => { if (!sel && list.length) setSel(list[0].id); }, [list, sel]);
  const inv = list.find((i) => i.id === sel) ?? null;
  return (
    <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[380px_1fr]">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between"><Label>{t("list", { n: list.length })}</Label><a href={investorsHref} className="text-[12px] font-semibold text-oms-ink-2">{t("createLogin")}</a></div>
        {list.map((i) => {
          const cur = Object.keys(i.money?.by_currency ?? {})[0];
          const m = cur ? i.money!.by_currency[cur] : null;
          return (
            <button key={i.id} type="button" onClick={() => setSel(i.id)} className={`flex items-center gap-3 rounded-[10px] border bg-oms-surface p-3 text-start ${sel === i.id ? "border-oms-ink-1 ring-1 ring-oms-ink-1" : "border-oms-border"}`}>
              <span className={`grid h-9 w-9 flex-none place-items-center rounded-full text-[13px] font-bold ${i.configured ? "bg-oms-ink-1 text-white" : "border border-dashed border-oms-border-strong bg-oms-sunken text-oms-ink-3"}`}>{(i.full_name ?? i.email).slice(0, 2).toUpperCase()}</span>
              <span className="min-w-0 flex-1"><b className="block truncate text-[13.5px] font-semibold">{i.legal_name ?? i.full_name ?? i.email}</b><span className="block text-[11.5px] text-oms-ink-3">{i.money?.deals_total ? t("dealsCapital", { n: i.money.deals_total, capital: money(m?.capital_outstanding ?? 0, cur, locale) }) : t("noDeal")}</span></span>
              <span className="text-end">{!i.configured ? <Tag tone="warn">{t("incomplete")}</Tag> : <><b className="block text-[14px] tabular-nums text-oms-ok">{fmtNum(m?.available ?? 0)}</b><span className="block text-[10.5px] text-oms-ink-3">{t("available")}</span></>}</span>
            </button>
          );
        })}
        <Callout>{t("createLoginHint")}</Callout>
      </div>
      <div className="flex flex-col gap-3.5">{inv && (inv.configured ? <InvestorDetail inv={inv} locale={locale} go={go} /> : <Onboarding inv={inv} locale={locale} onSaved={() => mutate()} />)}</div>
    </div>
  );
}

function Onboarding({ inv, locale, onSaved }: { inv: Inv; locale: string; onSaved: () => void }) {
  const t = useTranslations("investorAdmin.investors");
  const tc = useTranslations("investorAdmin.common");
  const [legal, setLegal] = useState(inv.full_name ?? "");
  const [method, setMethod] = useState("bank_transfer");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function save() {
    setBusy(true); setErr(null);
    const r = await fetch("/api/admin/investments/investors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: inv.id, legal_name: legal, payout_method: method, notes }) });
    setBusy(false);
    if (r.ok) onSaved(); else setErr(tc("error"));
  }
  return (
    <Card>
      <Label>{t("onboarding", { name: inv.full_name ?? inv.email })}</Label>
      <ol className="m-0 mt-3 list-none space-y-3 border-s-2 border-oms-border ps-4">
        <li><b className="block text-[12.5px] font-semibold text-oms-ok">✓ {t("stepLogin")}</b><span className="text-[11.5px] text-oms-ink-3">{inv.email}</span></li>
        <li><b className="block text-[12.5px] font-semibold">{t("stepProfile")}</b><span className="text-[11.5px] text-oms-ink-3">{t("stepProfileHint")}</span></li>
        <li className="opacity-60"><b className="block text-[12.5px] font-semibold">{t("stepDeal")}</b><span className="text-[11.5px] text-oms-ink-3">{t("stepDealHint")}</span></li>
      </ol>
      <div className="mt-3"><Callout>{t("onboardingNote")}</Callout></div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Field label={t("legalName")}><input className={inputCls} value={legal} onChange={(e) => setLegal(e.target.value)} /></Field>
        <Field label={t("payoutMethod")}><select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value)}><option value="bank_transfer">{t("bank_transfer")}</option><option value="cash">{t("cash")}</option><option value="wallet">{t("wallet")}</option></select></Field>
        <div className="col-span-2"><Field label={t("notes")}><textarea className={`${inputCls} h-16 py-2`} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field></div>
      </div>
      {err && <div className="mt-2"><Callout tone="bad">{err}</Callout></div>}
      <div className="mt-3 flex justify-end"><Btn variant="primary" onClick={save} disabled={busy || !legal.trim()}>{t("configureProfile")}</Btn></div>
      <span className="hidden">{locale}</span>
    </Card>
  );
}

function InvestorDetail({ inv, locale, go }: { inv: Inv; locale: string; go: (t: AdminTab, c?: { investorId?: string; dealId?: string }) => void }) {
  const t = useTranslations("investorAdmin.investors");
  const tc = useTranslations("investorAdmin.common");
  const { data } = useSWR<{ data: { portfolio: PortfolioPayload; ledger: Ledger[] } }>(`/api/admin/investments/investors/${inv.id}/ledger`, fetcher);
  const p = data?.data.portfolio;
  const cur = p?.investor.currency ?? Object.keys(p?.by_currency ?? {})[0] ?? "";
  const s = p?.by_currency?.[cur];
  if (!p || !s) return <Card><div className="py-6 text-center text-[12.5px] text-oms-ink-3">{tc("loading")}</div></Card>;
  return (
    <>
      <Card>
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <Label>{t("positionValue", { name: inv.legal_name ?? inv.full_name ?? inv.email })}</Label>
            <div className="mt-1 flex items-baseline gap-1.5"><span className="text-[30px] font-bold leading-[1.05] tabular-nums tracking-[-0.02em]">{fmtNum(s.position_value)}</span><span className="text-[13px] font-semibold text-oms-ink-3">{cur}</span>{s.return_pct !== null && <Tag tone={s.return_pct >= 0 ? "ok" : "bad"}>{s.return_pct >= 0 ? "▲" : "▼"} {pct(Math.abs(s.return_pct))}</Tag>}</div>
            <div className="mt-1 text-[11.5px] text-oms-ink-3">{t("earned", { invested: money(s.capital_invested, cur, locale), earned: moneySigned(s.total_earned, cur, locale) })}{s.first_start_date ? ` · ${dateShort(s.first_start_date, locale)}` : ""} · {inv.legal_name} · {inv.payout_method ? t(inv.payout_method as "bank_transfer") : ""}</div>
          </div>
          <div className="flex gap-2"><Btn onClick={() => go("corrections", { investorId: inv.id })}>{t("postCorrection")}</Btn><Btn variant="primary" onClick={() => go("deals", { investorId: inv.id })}>{t("newDeal")}</Btn></div>
        </div>
        <div className="mt-3.5 grid grid-cols-5 gap-2">
          <Kpi label={t("kCapital")} v={fmtNum(s.capital_outstanding)} unit={cur} h={s.next_maturity ? `${p.deals.length} · ${dateLong(s.next_maturity, locale)}` : ""} />
          <Kpi label={t("kSettled")} v={fmtNum(s.settled_lifetime, 2)} h="" />
          <Kpi label={t("kWithdrawn")} v={fmtNum(s.withdrawn, 2)} h="" />
          <Kpi label={t("kAvailable")} v={fmtNum(s.available, 2)} h={s.open_claims > 0 ? t("kOpenClaims", { amount: fmtNum(s.open_claims) }) : ""} cls="text-oms-ok" />
          <Kpi label={t("kAccrued")} v={fmtNum(s.unsettled_payable, 2)} h={t("kAccruedHint")} cls="text-oms-ink-2" />
        </div>
      </Card>
      <Card pad={false}>
        <div className="px-3.5 pb-1 pt-3"><Label>{t("deals")}</Label></div>
        <table className="w-full border-collapse text-[12.5px]"><thead><tr><th className={thL}>{t("colDeal")}</th><th className={th}>{t("colNet")}</th><th className={th}>{t("colShare")}</th><th className={th}>{t("colSettled")}</th><th className={th}>{t("colUnsettled")}</th><th className={th}>{t("colCarried")}</th><th className={thL}>{t("colState")}</th></tr></thead>
          <tbody>{p.deals.map((d) => (
            <tr key={d.id} className="cursor-pointer hover:bg-oms-sunken" onClick={() => go("deals", { dealId: d.id })}>
              <td className={tdL}>{d.image_url && <img src={d.image_url} alt="" className="me-2 inline-block h-[30px] w-[30px] rounded-md object-cover align-middle" />}{d.product_name}<span className="block text-[11px] text-oms-ink-3">{d.terms ? `${fmtNum(d.terms.sharePct)} % · ${money(d.terms.capitalAmount, d.currency, locale)}` : ""}</span></td>
              <td className={td}>—</td><td className={td}><Money v={d.cumulative_share} /></td><td className={td}>{fmtNum(d.settled_payable)}</td><td className={`${td} text-oms-ink-2`}>{fmtNum(d.payable_now)}</td><td className={td}>{d.carried_loss_after ? <span className="text-oms-age-late">−{fmtNum(d.carried_loss_after)}</span> : "—"}</td>
              <td className={tdL}><span className="flex flex-wrap gap-1">{d.carried_loss_after > 0 && <Tag tone="warn">{tc("carried").toLowerCase()} {fmtNum(d.carried_loss_after)}</Tag>}{(d.excluded?.dexpress ?? 0) > 0 && <Tag tone="warn">{tc("dexpressExcluded", { n: d.excluded.dexpress })}</Tag>}{d.in_flight.count > 0 && <Tag>{tc("inFlight", { n: d.in_flight.count })}</Tag>}{!d.carried_loss_after && !d.in_flight.count && <Tag tone="ok">{tc("healthy")}</Tag>}</span></td>
            </tr>
          ))}</tbody></table>
      </Card>
      <Card>
        <Label className="mb-1.5">{t("ledger")}</Label>
        <ul className="m-0 list-none p-0">{(data?.data.ledger ?? []).map((e) => {
          const amt = Number(e.amount); const out = e.entry_type === "withdrawal" || e.entry_type === "principal_return";
          return <li key={e.id} className="flex items-start gap-2.5 border-t border-oms-border py-2 first:border-t-0"><span className="min-w-0 flex-1"><b className="block text-[13px] font-semibold">{e.entry_type}{e.investor_deals?.products?.name ? ` · ${e.investor_deals.products.name}` : ""}</b><span className="block text-[11.5px] text-oms-ink-3">{dateTimeShort(e.created_at, locale)}{e.note ? ` · ${e.note}` : ""}{e.users?.email ? ` · ${t("by", { who: e.users.email })}` : ""}</span></span><Money v={out ? -amt : amt} dp={2} className="text-[13.5px] font-bold" /></li>;
        })}</ul>
      </Card>
    </>
  );
}
function Kpi({ label, v, unit, h, cls = "" }: { label: string; v: string; unit?: string; h: string; cls?: string }) {
  return <div className="rounded-lg border border-oms-border bg-oms-surface px-3 py-2.5"><Label>{label}</Label><div className={`mt-1 whitespace-nowrap text-[16px] font-bold tabular-nums ${cls}`}>{v}{unit && <span className="ms-1 text-[10.5px] font-semibold text-oms-ink-3">{unit}</span>}</div><div className="mt-0.5 text-[10.5px] text-oms-ink-3">{h}</div></div>;
}
