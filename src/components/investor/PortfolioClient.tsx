"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import type { PortfolioPayload, DealCard, CurrencySummary } from "@/lib/investors/portfolio-summary";
import { currencyLabel, dateLong, dateShort, fmtNum, fmtSigned, minutesSince, money, moneySigned, pct } from "@/lib/investors/ui-format";
import { EquityCurve } from "./EquityCurve";
import { RangePills, rangeStartISO, type Range } from "./RangePills";
import { Sparkline } from "./Sparkline";
import { FreshnessLine } from "./FreshnessLine";
import { LedgerList } from "./LedgerList";

export const PORTFOLIO_KEY = "/api/investor/portfolio";

export function PortfolioClient({ initial, locale, today }: { initial: PortfolioPayload; locale: string; today: string }) {
  const t = useTranslations("investor.home");
  const { data, error } = useSWR<{ data: PortfolioPayload }>(PORTFOLIO_KEY, fetcher, { fallbackData: { data: initial }, refreshInterval: 60_000, revalidateOnFocus: true, keepPreviousData: true });
  const p = data?.data ?? initial;
  const [range, setRange] = useState<Range>("all");
  const currencies = Object.values(p.by_currency).filter((c) => c.capital_invested > 0 || c.settled_lifetime !== 0 || p.deals.some((d) => d.currency === c.currency));
  const base = `/${locale}/investor`;

  if (!p.deals.length) {
    return (
      <div className="flex flex-col gap-3">
        <FreshnessLine asOf={p.as_of} error={!!error} />
        <section className="rounded-[10px] border border-oms-border bg-oms-surface p-5 text-center">
          <div className="text-[16px] font-semibold">{t("noDeals")}</div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-oms-ink-2">{t("noDealsHint")}</p>
        </section>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3.5">
      <FreshnessLine asOf={p.as_of} error={!!error} />
      {currencies.map((c) => (
        <CurrencyHero key={c.currency} c={c} deals={p.deals.filter((d) => d.currency === c.currency)} range={range} onRange={setRange} locale={locale} today={today} />
      ))}
      <div className="mt-0.5 flex items-center justify-between">
        <span className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-oms-ink-3">{t("yourProducts")} · {t("deals", { n: p.deals.length })}</span>
      </div>
      <div className="flex flex-col gap-2 sm:grid sm:grid-cols-2">
        {p.deals.map((d) => <DealCardView key={d.id} d={d} locale={locale} range={range} today={today} href={`${base}/deals/${d.id}`} />)}
      </div>
      <div className="mt-0.5 flex items-center justify-between">
        <span className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-oms-ink-3">{t("recent")}</span>
        <Link href={`${base}/activity`} className="text-[12px] font-semibold text-oms-ink-2">{t("seeAll")}</Link>
      </div>
      <section className="rounded-[10px] border border-oms-border bg-oms-surface px-3.5 py-0.5">
        <LedgerList locale={locale} limit={5} compact />
      </section>
    </div>
  );
}

function CurrencyHero({ c, deals, range, onRange, locale, today }: { c: CurrencySummary; deals: DealCard[]; range: Range; onRange: (r: Range) => void; locale: string; today: string }) {
  const t = useTranslations("investor.home");
  const cur = c.currency;
  const curLbl = currencyLabel(cur, locale);
  const from = rangeStartISO(range, today, c.first_start_date ?? today, null);
  const pts = useMemo(() => c.series.filter((p) => p.d >= from).map((p) => ({ d: p.d, v: p.value })), [c.series, from]);
  const payoutDays = useMemo(() => {
    const s = new Set<string>();
    for (const d of deals) if (d.last_statement_end) s.add(d.last_statement_end);
    return [...s].filter((d) => d >= from).map((d) => ({ d }));
  }, [deals, from]);
  const unsettledFrom = deals.map((d) => d.last_statement_end).filter((x): x is string => !!x).sort().pop();
  const nextUnsettled = unsettledFrom ? addDay(unsettledFrom) : null;
  const daysTotal = c.first_start_date && c.next_maturity ? daysBetween(c.first_start_date, c.next_maturity) : 0;
  const daysElapsed = c.first_start_date ? Math.min(daysTotal, daysBetween(c.first_start_date, today)) : 0;
  return (
    <>
      <section className="rounded-[10px] border border-oms-border bg-oms-surface p-3.5">
        <div className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-oms-ink-3">{t("positionValue")}</div>
        <div className="mt-1.5 flex flex-wrap items-baseline gap-1.5">
          <span className="text-[34px] font-bold leading-[1.05] tracking-[-0.02em] tabular-nums">{fmtNum(c.position_value)}</span>
          <span className="text-[14px] font-semibold text-oms-ink-3">{curLbl}</span>
          {c.return_pct !== null && (
            <span className={`ms-1 inline-flex h-[22px] items-center rounded-full px-2 text-[12px] font-bold tabular-nums ${c.return_pct >= 0 ? "bg-oms-ok-bg text-oms-ok" : "bg-oms-bad-bg text-oms-age-late"}`}>{c.return_pct >= 0 ? "▲" : "▼"} {pct(Math.abs(c.return_pct))}</span>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-oms-ink-2">
          <span>{t("invested", { amount: money(c.capital_invested, cur, locale) })}</span>
          <span className="text-oms-border-strong">·</span>
          <span className={`font-semibold ${c.total_earned >= 0 ? "text-oms-ok" : "text-oms-age-late"}`}>{t("earned", { amount: moneySigned(c.total_earned, cur, locale) })}</span>
          {c.first_start_date && (<><span className="text-oms-border-strong">·</span><span>{t("since", { date: dateShort(c.first_start_date, locale) })}</span></>)}
        </div>
        <div className="mt-2">
          <EquityCurve points={pts} color="#15803D" unsettledFrom={nextUnsettled} markers={payoutDays} locale={locale} label={t("legendValue")} currency={curLbl} />
        </div>
        <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] text-oms-ink-2">
          <span><i className="me-1.5 inline-block w-3.5 border-t-2 border-[#15803D] align-middle" />{t("legendValue")}</span>
          <span><i className="me-1.5 inline-block h-2.5 w-3 rounded-[2px] bg-oms-sunken outline outline-1 outline-oms-border-strong align-middle" />{t("legendUnsettled")}</span>
          <span><i className="me-1.5 inline-block h-2 w-2 rounded-full border-2 border-oms-ink-1 align-middle" />{t("legendPayout")}</span>
        </div>
        <div className="mt-2.5"><RangePills value={range} onChange={onRange} /></div>
      </section>
      <div className="grid grid-cols-3 gap-2">
        <Tile label={t("capital")} value={fmtNum(c.capital_outstanding)} unit={curLbl} hint={c.next_maturity ? t("capitalBack", { date: dateLong(c.next_maturity, locale) }) : ""} progress={daysTotal ? daysElapsed / daysTotal : undefined} progressLabel={daysTotal ? t("day", { n: daysElapsed, total: daysTotal }) : undefined} />
        <Tile label={t("available")} value={fmtNum(c.available_for_request)} unit={curLbl} hint={t("availableHint")} valueClass="text-oms-ok" cta={{ href: `/${locale}/investor/withdrawals`, label: t("withdraw") }} />
        <Tile label={t("accrued")} value={fmtNum(c.unsettled_payable)} unit={curLbl} hint={t("accruedHint")} valueClass="text-oms-ink-2" />
      </div>
    </>
  );
}

function Tile({ label, value, unit, hint, valueClass = "", progress, progressLabel, cta }: { label: string; value: string; unit: string; hint: string; valueClass?: string; progress?: number; progressLabel?: string; cta?: { href: string; label: string } }) {
  return (
    <div className="min-w-0 rounded-[10px] border border-oms-border bg-oms-surface px-2.5 pb-2.5 pt-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-[.06em] text-oms-ink-3">{label}</div>
      <div className={`mt-1 whitespace-nowrap text-[17px] font-bold tracking-[-0.01em] tabular-nums ${valueClass}`}>{value}<span className="ms-1 text-[10.5px] font-semibold text-oms-ink-3">{unit}</span></div>
      <div className="mt-0.5 text-[10.5px] leading-[1.35] text-oms-ink-3">{hint}</div>
      {progress !== undefined && (<><div className="mt-1.5 h-1 overflow-hidden rounded bg-oms-sunken"><i className="block h-full rounded bg-oms-ink-2" style={{ width: `${Math.round(progress * 100)}%` }} /></div><div className="mt-0.5 text-[10.5px] text-oms-ink-3">{progressLabel}</div></>)}
      {cta && <Link href={cta.href} className="mt-2 flex h-7 items-center justify-center rounded-lg bg-oms-ink-1 text-[12px] font-semibold text-white">{cta.label}</Link>}
    </div>
  );
}

export function DealCardView({ d, locale, range, today, href }: { d: DealCard; locale: string; range: Range; today: string; href: string }) {
  const t = useTranslations("investor.home");
  const cur = d.currency;
  const c = d.counts;
  const upPct = c.received ? (c.uploaded / c.received) * 100 : null;
  const dlPct = c.uploaded ? (c.delivered / c.uploaded) * 100 : null;
  // Share within range from the cumulative spark isn't available per range; the card shows all-time share (range affects the hero curve).
  const share = d.cumulative_share;
  const color = share >= 0 ? "#15803D" : "#B23A32";
  void range; void today;
  return (
    <Link href={href} className="block rounded-[10px] border border-oms-border bg-oms-surface p-3 transition-shadow duration-150 hover:shadow-panel">
      <div className="flex items-center gap-2.5">
        {d.image_url ? <img src={d.image_url} alt="" loading="lazy" className="h-[52px] w-[52px] flex-none rounded-lg border border-oms-border object-cover" /> : <div className="grid h-[52px] w-[52px] flex-none place-items-center rounded-lg bg-oms-sunken text-[16px] font-bold text-oms-ink-3">{(d.product_name ?? "?").slice(0, 1)}</div>}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px] font-semibold">{d.product_name}</div>
          <div className="mt-0.5 text-[11.5px] text-oms-ink-3">{d.terms ? `${fmtNum(d.terms.sharePct)} % · ${money(d.terms.capitalAmount, cur, locale)}` : ""}</div>
        </div>
        <div className="flex-none text-end">
          <div className={`text-[15px] font-bold tabular-nums tracking-[-0.01em] ${share > 0 ? "text-oms-ok" : share < 0 ? "text-oms-age-late" : "text-oms-ink-2"}`}>{fmtSigned(share)}</div>
          <div className="text-[10.5px] text-oms-ink-3">{t("yourShare")}</div>
        </div>
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-oms-border pt-2">
        <div className="flex items-center gap-1.5 whitespace-nowrap text-[11px] tabular-nums text-oms-ink-2">
          <b className="font-semibold text-oms-ink-1">{fmtNum(c.received ?? 0)}</b> {t("received")}
          <span className="text-oms-border-strong">→</span>
          <span className="rounded bg-oms-sunken px-1.5 text-[10.5px] font-semibold">{pct(upPct, 0)}</span> {t("shipped")}
          <span className="text-oms-border-strong">→</span>
          <span className="rounded bg-oms-sunken px-1.5 text-[10.5px] font-semibold">{pct(dlPct, 0)}</span> {t("delivered")}
        </div>
        <Sparkline values={d.spark} color={color} />
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {d.carried_loss_after > 0
          ? <span className="inline-flex h-5 items-center rounded-full bg-oms-warn-bg px-2 text-[10.5px] font-semibold text-oms-warn-ink">{t("carriedLoss", { amount: fmtNum(d.carried_loss_after) })}</span>
          : <span className="inline-flex h-5 items-center rounded-full bg-oms-ok-bg px-2 text-[10.5px] font-semibold text-oms-ok">{t("settled", { amount: fmtNum(d.settled_payable) })}</span>}
        <span className="inline-flex h-5 items-center rounded-full bg-oms-sunken px-2 text-[10.5px] font-semibold text-oms-ink-2">{t("inProgress", { amount: fmtSigned(d.payable_now) })}</span>
        {(d.excluded?.dexpress ?? 0) > 0 && <span className="inline-flex h-5 items-center rounded-full bg-oms-sunken px-2 text-[10.5px] font-semibold text-oms-ink-2">{t("dexpressExcluded", { n: d.excluded.dexpress })}</span>}
      </div>
    </Link>
  );
}

function addDay(iso: string): string { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }
function daysBetween(a: string, b: string): number { return Math.max(0, Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86_400_000)); }
export { minutesSince };
