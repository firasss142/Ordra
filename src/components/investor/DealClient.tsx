"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import useSWR from "swr";
import useSWRInfinite from "swr/infinite";
import { ArrowDown, ArrowLeft, Flame, RotateCcw, TriangleAlert } from "lucide-react";
import { fetcher } from "@/lib/swr-config";
import type { DaySeriesRow, Waterfall } from "@/lib/investors/accrual";
import type { DealCard, StatementLite } from "@/lib/investors/portfolio-summary";
import type { TermsVersion } from "@/lib/investors/terms";
import type { FeedEvent } from "@/lib/investors/feed";
import { currencyLabel, dateLong, dateShort, fmtNum, fmtSigned, money, moneySigned, pct } from "@/lib/investors/ui-format";
import { EquityCurve } from "./EquityCurve";
import { FreshnessLine } from "./FreshnessLine";
import { RangePills, type Range } from "./RangePills";

interface DealPayload {
  card: DealCard;
  terms: TermsVersion[];
  range: Range;
  range_from: string;
  series: DaySeriesRow[];
  totals: (Waterfall & { perUnit?: Record<string, number | null> }) | null;
  yours: Waterfall | null;
  statements: StatementLite[];
  payouts: { date: string; amount: number; statement_id: string }[];
  as_of: string | null;
}

const COST_HUES = { ads: "#ea6a1f", cogs: "#2563eb", delivery: "#0d9488", returns: "#6d5ce0", packing: "#e87ba4", profit: "#15803d", loss: "#DC2626" };

export function DealClient({ dealId, initial, locale }: { dealId: string; initial: DealPayload; locale: string }) {
  const t = useTranslations("investor.deal");
  const [range, setRange] = useState<Range>("all");
  const key = `/api/investor/deals/${dealId}?range=${range}`;
  const { data, error } = useSWR<{ data: DealPayload }>(key, fetcher, { fallbackData: range === "all" ? { data: initial } : undefined, refreshInterval: 60_000, keepPreviousData: true });
  const p = data?.data ?? initial;
  const d = p.card;
  const cur = d.currency;
  const share = d.terms?.sharePct ?? 0;
  const c = d.counts;
  const upPct = c.received ? (c.uploaded / c.received) * 100 : null;
  const dlPct = c.uploaded ? (c.delivered / c.uploaded) * 100 : null;
  const retPct = c.delivered + c.returned ? (c.returned / (c.delivered + c.returned)) * 100 : null;

  // Range totals from the day series (product 100 %) and yours (per-day share applied).
  const R = useMemo(() => {
    const s = p.series;
    const sum = (k: keyof DaySeriesRow) => s.reduce((a, r) => a + Number(r[k]), 0);
    const y = (k: keyof DaySeriesRow) => s.reduce((a, r) => a + Number(r[k]) * (r.pct / 100), 0);
    return {
      rev: sum("rev"), cogs: sum("cogs"), dlv: sum("dlv"), ret: sum("ret"), pack: sum("pack"), proc: sum("proc"), ads: sum("ads"), gross: sum("gross"), net: sum("net"), shareSum: sum("share"), dc: sum("dc"), rc: sum("rc"),
      yRev: y("rev"), yCogs: y("cogs"), yDlv: y("dlv"), yRet: y("ret"), yPack: y("pack"), yProc: y("proc"), yAds: y("ads"), yGross: y("gross"), yNet: y("net"),
    };
  }, [p.series]);

  const curve = useMemo(() => {
    return p.series.map((r) => { return { d: r.d, v: Number((r.cum).toFixed(3)), sub: `${r.dc} ${t("deliveredPaid").toLowerCase()} · ${r.rc} ${t("feedReturned").toLowerCase()} · ${t("adSpend").toLowerCase()} ${fmtNum(r.ads)}` }; });
  }, [p.series, t]);
  const curveColor = d.cumulative_share >= 0 ? "#15803D" : "#B23A32";
  const unsettledFrom = d.last_statement_end ? addDay(d.last_statement_end) : null;
  const perUnit = p.totals?.perUnit ?? {};
  const revPerDelivered = c.delivered ? (p.totals?.revenue ?? 0) / c.delivered : 0;
  const stack = c.delivered && p.totals ? [
    { k: "ads", v: p.totals.adSpend / c.delivered, hue: COST_HUES.ads, label: t("ads") },
    { k: "cogs", v: p.totals.cogs / c.delivered, hue: COST_HUES.cogs, label: t("cogs") },
    { k: "delivery", v: p.totals.deliveryCost / c.delivered, hue: COST_HUES.delivery, label: t("delivery") },
    { k: "returns", v: p.totals.returnCost / c.delivered, hue: COST_HUES.returns, label: t("returns") },
    { k: "packing", v: (p.totals.packingCost + p.totals.processingCost) / c.delivered, hue: COST_HUES.packing, label: t("packing") },
  ].filter((s) => s.v > 0) : [];
  const costPer = stack.reduce((a, s) => a + s.v, 0);
  const profitPer = revPerDelivered - costPer;
  const stackBase = Math.max(revPerDelivered, costPer) || 1;
  const cadence = d.terms ? t(`cadence.${d.terms.payoutCadence}`) : "";
  const inflightShare = d.in_flight?.expectedShare ?? 0;

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-center justify-between">
        <Link href={`/${locale}/investor`} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-oms-ink-2"><ArrowLeft size={16} className="rtl:-scale-x-100" />{t("back")}</Link>
        <FreshnessLine asOf={p.as_of} error={!!error} />
      </div>
      <header className="flex items-center gap-3">
        {d.image_url ? <img src={d.image_url} alt="" className="h-16 w-16 rounded-[10px] border border-oms-border object-cover" /> : <div className="grid h-16 w-16 place-items-center rounded-[10px] bg-oms-sunken text-[20px] font-bold text-oms-ink-3">{(d.product_name ?? "?").slice(0, 1)}</div>}
        <div className="min-w-0">
          <h1 className="m-0 text-[17px] font-semibold leading-tight tracking-[-0.01em]">{d.product_name} <span className={`ms-1 inline-flex h-5 items-center rounded-full px-2 text-[10.5px] font-semibold ${d.status === "active" ? "bg-oms-ok-bg text-oms-ok" : "bg-oms-sunken text-oms-ink-2"}`}>{t(d.status === "active" ? "statusActive" : d.status === "matured" ? "statusMatured" : "statusClosed")}</span></h1>
          {d.terms && <div className="mt-0.5 text-[11.5px] leading-snug text-oms-ink-2">{t("terms", { pct: fmtNum(share), capital: money(d.terms.capitalAmount, cur, locale), start: dateShort(d.start_date, locale), end: dateLong(d.end_date, locale), cadence })}</div>}
          <div className="mt-1 h-1 w-40 overflow-hidden rounded bg-oms-sunken"><i className="block h-full rounded bg-oms-ink-2" style={{ width: `${d.days_total ? Math.round((d.days_elapsed / d.days_total) * 100) : 0}%` }} /></div>
          <div className="mt-0.5 text-[11.5px] text-oms-ink-2">{t("dayOf", { n: d.days_elapsed, total: d.days_total })}</div>
        </div>
      </header>
      <RangePills value={range} onChange={setRange} />

      {/* Conversion chain */}
      <section className="rounded-[10px] border border-oms-border bg-oms-surface p-3.5">
        <div className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-oms-ink-3">{t("chain")}</div>
        <div className="mt-1 grid grid-cols-[1fr_auto_auto] items-baseline gap-x-2.5 border-b border-oms-border pb-1 text-[10px] font-semibold uppercase tracking-[.04em] text-oms-ink-3"><span /><span className="text-end">{t("product")}</span><span className="min-w-[70px] text-end">{t("yours", { pct: fmtNum(share) })}</span></div>
        <Step k={t("adSpend")} p={fmtNum(R.ads)} y="—" />
        <LinkRow>{fmtNum(c.received ?? 0)} <small>{t("orders").toLowerCase()}</small></LinkRow>
        <Step k={t("orders")} p={fmtNum(c.received ?? 0)} y="" />
        <LinkRow>{pct(upPct)}<small>{t("ofReceived")}</small></LinkRow>
        <Step k={t("uploaded")} p={fmtNum(c.uploaded ?? 0)} y="" />
        <LinkRow>{pct(dlPct)}<small>{t("ofShipped")}</small>{c.inFlight > 0 && <span className="ms-2 inline-flex h-5 items-center rounded border border-dashed border-oms-border-strong px-1.5 text-[11px] font-semibold text-oms-ink-3">{t("inFlight", { n: c.inFlight })}</span>}</LinkRow>
        <Step k={t("deliveredPaid")} sub={t("returned", { n: c.returned ?? 0, pct: pct(retPct) })} p={fmtNum(c.delivered ?? 0)} y="" />
        <Step k={t("revenue")} p={fmtNum(R.rev)} y={fmtNum(R.yRev)} />
        <Step k={t("gross")} sub={t("grossSub")} p={fmtNum(R.gross)} y={fmtNum(R.yGross)} />
        <Step k={t("net")} sub={t("netSub")} p={<Money v={R.net} />} y={<Money v={R.yNet} />} total />
        {c.inFlight > 0 && <div className="mt-2 text-[11.5px] leading-snug text-oms-ink-3">{t("inFlightGhost", { n: c.inFlight, amount: moneySigned(inflightShare, cur, locale) })}</div>}
      </section>

      {/* Curve */}
      <section className="rounded-[10px] border border-oms-border bg-oms-surface p-3.5">
        <div className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-oms-ink-3">{t("cumShare")}</div>
        <div className="mt-2"><EquityCurve points={curve} color={curveColor} unsettledFrom={unsettledFrom} markers={p.payouts.map((x) => ({ d: x.date }))} zeroBand locale={locale} label={t("cumShare")} currency={currencyLabel(cur, locale)} signed /></div>
        <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] text-oms-ink-2">
          <span><i className="me-1.5 inline-block w-3.5 border-t-2 align-middle" style={{ borderColor: curveColor }} />{t("cumShare")}</span>
          {d.cumulative_share < 0 && <span><i className="me-1.5 inline-block h-2.5 w-3 rounded-[2px] bg-oms-warn-bg outline outline-1 outline-oms-age-warm align-middle" />{t("legendCarried")}</span>}
        </div>
      </section>

      {/* Waterfall */}
      <section className="rounded-[10px] border border-oms-border bg-oms-surface p-3.5">
        <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[.06em] text-oms-ink-3">{t("waterfall")}</div>
        <table className="w-full border-collapse text-[12.5px]">
          <thead><tr className="text-[10px] font-semibold uppercase tracking-[.05em] text-oms-ink-3"><th className="pb-1.5 text-start font-semibold" /><th className="pb-1.5 text-end font-semibold">{t("product")}</th><th className="pb-1.5 text-end font-semibold">{t("yours", { pct: fmtNum(share) })}</th></tr></thead>
          <tbody>
            <Row k={t("revenue")} u={perUnit.priceAvg != null ? `${fmtNum(R.dc)} × ${fmtNum(perUnit.priceAvg)} ${t("perParcel", { amount: "" }).trim()}` : undefined} p={R.rev} y={R.yRev} />
            <Row k={"− " + t("cogs")} u={perUnit.unitCogs != null ? t("perUnit", { amount: fmtNum(perUnit.unitCogs, perUnit.unitCogs % 1 ? 3 : 0) }) : undefined} p={-R.cogs} y={-R.yCogs} />
            <Row k={"− " + t("delivery")} u={perUnit.deliveryAvg != null ? t("avgPerParcel", { amount: fmtNum(perUnit.deliveryAvg, 2), n: R.dc }) : undefined} p={-R.dlv} y={-R.yDlv} />
            <Row k={"− " + t("returns")} u={perUnit.returnAvg != null ? t("avgPerParcel", { amount: fmtNum(perUnit.returnAvg, 2), n: R.rc }) : undefined} p={-R.ret} y={-R.yRet} />
            <Row k={"= " + t("gross")} p={R.gross} y={R.yGross} sub />
            <Row k={"− " + t("packing")} u={perUnit.packing != null ? t("perParcel", { amount: fmtNum(perUnit.packing, perUnit.packing % 1 ? 1 : 0) }) : undefined} p={-(R.pack + R.proc)} y={-(R.yPack + R.yProc)} />
            <Row k={"− " + t("ads")} u={t("adsSub")} p={-R.ads} y={-R.yAds} />
            <Row k={"= " + t("net")} p={R.net} y={R.yNet} tot />
            {d.carried_loss_after > 0 && <Row k={t("carriedToRecover")} u={t("carriedSub")} p={null} y={-d.carried_loss_after} />}
          </tbody>
        </table>
        <div className="mt-2.5 text-[11.5px] leading-snug text-oms-ink-3">
          {(d.excluded?.dexpress ?? 0) > 0 && <><b className="font-semibold text-oms-ink-2">{t("excludedLine", { n: d.excluded.dexpress })}</b><br /></>}
          {d.pending.count > 0 ? t("pendingLine", { n: d.pending.count }) : t("noPending")}
        </div>
      </section>

      {/* Per delivered order stack */}
      {c.delivered > 0 && (
        <section className="rounded-[10px] border border-oms-border bg-oms-surface p-3.5">
          <div className="text-[14px] font-semibold">{t("perDelivered", { amount: money(revPerDelivered, cur, locale, 2) })}</div>
          <div className="mb-2.5 mt-0.5 text-[11.5px] text-oms-ink-3">{t("perDeliveredSub")}</div>
          <div className="flex h-[30px] gap-0.5 overflow-hidden rounded-md bg-oms-sunken" style={{ direction: "ltr" }}>
            {stack.map((s) => <i key={s.k} className="block h-full" style={{ width: `${(s.v / stackBase) * 100}%`, background: s.hue }} title={s.label} />)}
            {profitPer > 0 && <i className="block h-full" style={{ width: `${(profitPer / stackBase) * 100}%`, background: COST_HUES.profit }} />}
          </div>
          <ul className="m-0 mt-2 list-none p-0">
            {stack.map((s) => <li key={s.k} className="flex items-center gap-2 border-t border-oms-border py-1.5 text-[12px] first:border-t-0"><span className="h-2.5 w-2.5 flex-none rounded-[3px]" style={{ background: s.hue }} />{s.label}<b className="ms-auto tabular-nums">{fmtNum(s.v, 2)}</b><span className="w-11 text-end tabular-nums text-oms-ink-3">{pct((s.v / (revPerDelivered || 1)) * 100)}</span></li>)}
            <li className="flex items-center gap-2 border-t border-oms-border py-1.5 text-[12px]"><span className="h-2.5 w-2.5 flex-none rounded-[3px]" style={{ background: profitPer >= 0 ? COST_HUES.profit : COST_HUES.loss }} /><b>{profitPer >= 0 ? t("net") : t("loss")}</b><b className={`ms-auto tabular-nums ${profitPer >= 0 ? "text-oms-ok" : "text-oms-age-late"}`}>{fmtSigned(profitPer, 2)}</b><span className="w-11 text-end tabular-nums text-oms-ink-3">{pct((profitPer / (revPerDelivered || 1)) * 100)}</span></li>
          </ul>
          {profitPer < 0 && <div className="mt-2 flex items-start gap-2 rounded-lg border border-[#F0C4BF] bg-oms-bad-bg px-2.5 py-2 text-[12px] leading-snug text-oms-age-late"><TriangleAlert size={16} className="mt-0.5 flex-none" />{t("costsExceed", { amount: money(costPer, cur, locale, 2) })}</div>}
          {perUnit.unitCogs ? <div className="mt-2 flex items-start gap-2 rounded-lg border border-[#F0D9A8] bg-oms-warn-bg px-2.5 py-2 text-[12px] leading-snug text-oms-warn-ink"><Flame size={16} className="mt-0.5 flex-none" />{t("adsX", { x: fmtNum(((p.totals?.adSpend ?? 0) / c.delivered) / (perUnit.unitCogs || 1), 1) })}</div> : null}
        </section>
      )}

      {/* Statements */}
      <section className="rounded-[10px] border border-oms-border bg-oms-surface p-3.5">
        <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[.06em] text-oms-ink-3">{t("statements")}</div>
        {p.statements.length === 0 && <div className="py-3 text-[12.5px] text-oms-ink-3">{t("noStatements")}</div>}
        <ul className="m-0 list-none p-0">
          {[...p.statements].reverse().map((s) => (
            <li key={s.id} className="flex items-start gap-2.5 border-t border-oms-border py-2.5 first:border-t-0">
              <span className={`grid h-[30px] w-[30px] flex-none place-items-center rounded-full ${s.payable > 0 ? "bg-oms-ok-bg text-oms-ok" : "bg-oms-sunken text-oms-ink-3"}`}><ArrowDown size={15} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold">{t("statement", { n: s.sequence_no })} · {dateShort(s.period_start, locale)} → {dateShort(s.period_end, locale)}</span>
                <span className="block text-[11.5px] leading-snug text-oms-ink-3">{t("net")} {fmtSigned(s.net_profit)} · {fmtNum(share)} % = {fmtSigned(s.investor_share)}{s.carried_loss_after > 0 ? <span className="text-oms-warn-ink"> · {t("carriedToRecover").toLowerCase()} {fmtNum(s.carried_loss_after)}</span> : null}</span>
              </span>
              <span className="flex-none text-end"><b className={`block text-[13.5px] tabular-nums ${s.payable > 0 ? "text-oms-ok" : "text-oms-ink-2"}`}>{s.payable > 0 ? "+" : ""}{fmtNum(s.payable)}</b><span className="block text-[10.5px] text-oms-ink-3">{t("payable")}</span></span>
            </li>
          ))}
        </ul>
      </section>

      <Feed dealId={dealId} locale={locale} currency={cur} />
    </div>
  );
}

function Money({ v }: { v: number }) { return <span className={v >= 0 ? "text-oms-ok" : "text-oms-age-late"}>{fmtSigned(v)}</span>; }
function Step({ k, sub, p, y, total = false }: { k: string; sub?: string; p: React.ReactNode; y: React.ReactNode; total?: boolean }) {
  return (
    <div className={`grid grid-cols-[1fr_auto_auto] items-baseline gap-x-2.5 py-2 ${total ? "mt-1 border-t border-oms-border-strong pt-2.5" : ""}`}>
      <div className="text-[12.5px] text-oms-ink-2"><b className="block text-[13px] font-semibold text-oms-ink-1">{k}</b>{sub && <span>{sub}</span>}</div>
      <div className={`text-end font-bold tabular-nums tracking-[-0.01em] ${total ? "text-[16px]" : "text-[14px]"}`}>{p}</div>
      <div className={`min-w-[70px] text-end font-bold tabular-nums ${total ? "text-[16px]" : "text-[14px]"} ${y === "" ? "text-oms-border-strong" : ""}`}>{y === "" ? "" : y}</div>
    </div>
  );
}
function LinkRow({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-2 ps-1.5"><span className="ms-1.5 h-4 w-px bg-oms-border-strong" /><span className="inline-flex h-5 items-center rounded-[5px] bg-oms-sunken px-1.5 text-[11px] font-bold tabular-nums text-oms-ink-1 [&_small]:ms-1 [&_small]:font-medium [&_small]:text-oms-ink-3">{children}</span></div>;
}
function Row({ k, u, p, y, sub = false, tot = false }: { k: string; u?: string; p: number | null; y: number; sub?: boolean; tot?: boolean }) {
  const cls = tot ? "font-bold text-[14px] border-t-2 border-oms-ink-1" : sub ? "font-semibold bg-oms-sunken" : "";
  const color = (v: number) => (tot ? (v >= 0 ? "text-oms-ok" : "text-oms-age-late") : v < 0 && !sub ? "text-oms-ink-2" : "");
  return (
    <tr className={cls}>
      <td className="border-t border-oms-border py-1.5 text-start">{k}{u && <span className="block text-[10.5px] font-normal text-oms-ink-3">{u}</span>}</td>
      <td className={`border-t border-oms-border py-1.5 text-end tabular-nums ${p === null ? "" : color(p)}`}>{p === null ? "" : fmtSigned(p)}</td>
      <td className={`border-t border-oms-border py-1.5 text-end tabular-nums ${color(y)}`}>{fmtSigned(y)}</td>
    </tr>
  );
}

function Feed({ dealId, locale, currency }: { dealId: string; locale: string; currency: string }) {
  const t = useTranslations("investor.deal");
  const th = useTranslations("investor.home");
  const getKey = (i: number, prev: { next_cursor: string | null } | null) => (i > 0 && !prev?.next_cursor ? null : `/api/investor/deals/${dealId}/feed?limit=25${i > 0 && prev?.next_cursor ? `&cursor=${prev.next_cursor}` : ""}`);
  const { data, size, setSize, isValidating } = useSWRInfinite<{ data: FeedEvent[]; next_cursor: string | null }>(getKey, fetcher, { revalidateFirstPage: false });
  const events = (data ?? []).flatMap((p) => p.data);
  const hasMore = !!data?.[data.length - 1]?.next_cursor;
  return (
    <section className="rounded-[10px] border border-oms-border bg-oms-surface p-3.5">
      <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[.06em] text-oms-ink-3">{t("feed")}</div>
      {data && events.length === 0 && <div className="py-3 text-[12.5px] text-oms-ink-3">{t("noFeed")}</div>}
      <ul className="m-0 list-none p-0">
        {events.map((e) => {
          const del = e.event === "delivered"; const pend = e.event === "pending_billing";
          return (
            <li key={e.id} className="flex items-start gap-2.5 border-t border-oms-border py-2 first:border-t-0">
              <span className={`grid h-[30px] w-[30px] flex-none place-items-center rounded-full ${del ? "bg-oms-ok-bg text-oms-ok" : pend ? "bg-oms-sunken text-oms-ink-3" : "bg-oms-bad-bg text-oms-age-late"}`}>{del || pend ? <ArrowDown size={15} /> : <RotateCcw size={15} />}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-semibold">{del ? t("feedDelivered") : pend ? t("feedPending") : t("feedReturned")} · {dateShort(e.at, locale)}</span>
                <span className="block text-[11px] leading-snug text-oms-ink-3">
                  {del || pend ? `+${fmtNum(e.amounts.revenue)} ${t("feedRevenue")} − ${fmtNum(e.amounts.cogs, e.amounts.cogs % 1 ? 3 : 0)} ${t("feedCogs")} − ${fmtNum(e.amounts.delivery, 2)} ${t("feedDelivery")}` : `− ${fmtNum(e.amounts.return, 2)} ${t("feedReturn")}`}
                </span>
              </span>
              <span className="flex-none text-end"><b className={`block text-[13.5px] tabular-nums ${pend ? "text-oms-ink-3" : e.your_share >= 0 ? "text-oms-ok" : "text-oms-age-late"}`}>{moneySigned(e.your_share, currency, locale, 2)}</b><span className="block text-[10.5px] text-oms-ink-3">{th("yourShare")}</span></span>
            </li>
          );
        })}
      </ul>
      {hasMore && <button type="button" onClick={() => setSize(size + 1)} disabled={isValidating} className="mt-2 h-8 w-full rounded-lg border border-oms-border-strong bg-oms-surface text-[12.5px] font-semibold text-oms-ink-1">{t("loadMore")}</button>}
    </section>
  );
}

function addDay(iso: string): string { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }
