import { fromMillimes, toMillimes } from "@/lib/calculations/math";
import { applyCarriedLoss } from "./carried-loss";
import { eventPostings } from "./facts/daily-facts";
import type { OrderFactRow } from "./facts/order-facts";
import { addDaysISO } from "./facts/ad-spend-daily";
import { currentTerms, sharePctOn, type TermsVersion } from "./terms";

/**
 * ONE accrual function, TWO callers:
 *  - the rollup (cutoff = today) → investor_deal_snapshots for the portal;
 *  - the settlement preview/commit (cutoff = period_end) → statement draft.
 *
 * Both therefore agree by construction — the v1 "estimate ≠ statement" bug is
 * designed out. Pure: no I/O.
 *
 * Deal membership is by COHORT (order created within [start_date, end_date]);
 * money lands by EVENT day (two-posting rule); the share % is applied PER DAY
 * from the versioned terms; the delta method against the last statement gives
 * the unsettled amount and the restatement (late returns / late billing on
 * already-settled days); the carried-loss rule gives payable_now.
 */

export type DealStatus = "active" | "matured" | "closed";

export interface DealAccrualInput {
  deal: { id: string; startDate: string; endDate: string; status: DealStatus };
  terms: TermsVersion[];
  cutoffDate: string; // inclusive local day
  facts: OrderFactRow[]; // eligible cohort, all stages, incl. excluded rows
  adSpendByDay: Map<string, number>; // day → currency units (product-mapped only)
  priorStatements: { periodEnd: string; cumulativeShareThrough: number; carriedLossAfter: number }[];
  todayDate: string;
}

export interface Waterfall {
  revenue: number;
  cogs: number;
  deliveryCost: number;
  returnCost: number;
  packingCost: number;
  processingCost: number;
  adSpend: number;
  grossProfit: number;
  netProfit: number;
}

export interface DaySeriesRow {
  d: string;
  rev: number;
  cogs: number;
  dlv: number;
  ret: number;
  pack: number;
  proc: number;
  ads: number;
  gross: number;
  net: number;
  pct: number;
  share: number;
  cum: number; // cumulative share through this day
  dc: number; // delivered events landed
  rc: number; // returned events landed
  pend: number; // pending (unbilled) outcomes landed
}

export interface DealAccrualResult {
  days: DaySeriesRow[];
  totals: Waterfall & {
    perUnit: { unitCogs: number | null; packing: number | null; processing: number | null; deliveryAvg: number | null; returnAvg: number | null; priceAvg: number | null };
  };
  yours: Waterfall;
  cumulativeShare: number;
  unsettledShare: number;
  restatementDelta: number;
  carriedLossBefore: number;
  payableNow: number;
  carriedLossAfter: number;
  lossApplied: number;
  pending: { count: number; revenueGross: number };
  inFlight: { count: number; expectedRevenue: number; expectedShare: number };
  counts: {
    received: number;
    uploaded: number;
    delivered: number;
    returned: number;
    notShipped: number;
    inFlight: number;
    excludedDexpress: number;
    excludedDeleted: number;
    pendingBilling: number;
  };
  rates: { confirmed: number | null; delivered: number | null; returned: number | null };
  sharePctToday: number;
  termsToday: TermsVersion | null;
  lastStatementEnd: string | null;
}

function pctOrNull(num: number, den: number): number | null {
  return den > 0 ? Math.round((num / den) * 10000) / 100 : null;
}

export function computeDealAccrual(input: DealAccrualInput): DealAccrualResult {
  const { deal, terms, cutoffDate, facts, adSpendByDay, priorStatements } = input;
  const start = deal.startDate;
  const end = cutoffDate < deal.endDate ? cutoffDate : deal.endDate;
  const last = priorStatements.length
    ? [...priorStatements].sort((a, b) => (a.periodEnd < b.periodEnd ? -1 : 1))[priorStatements.length - 1]
    : null;

  // ── per-day accumulators (millimes) ──────────────────────────────────────
  type D = { rev: number; cogs: number; dlv: number; ret: number; pack: number; proc: number; dc: number; rc: number; pend: number };
  const byDay = new Map<string, D>();
  const day = (d: string): D => {
    let x = byDay.get(d);
    if (!x) {
      x = { rev: 0, cogs: 0, dlv: 0, ret: 0, pack: 0, proc: 0, dc: 0, rc: 0, pend: 0 };
      byDay.set(d, x);
    }
    return x;
  };

  const counts = { received: 0, uploaded: 0, delivered: 0, returned: 0, notShipped: 0, inFlight: 0, excludedDexpress: 0, excludedDeleted: 0, pendingBilling: 0 };
  let pendingCount = 0;
  let pendingRev = 0;
  let inFlightCount = 0;
  let inFlightRev = 0;
  let unitCogsSum = 0;
  let unitCogsN = 0;
  let packSnapSum = 0;
  let packSnapN = 0;
  let procSnapSum = 0;
  let procSnapN = 0;
  let priceSum = 0;
  let priceN = 0;

  for (const f of facts) {
    if (f.cohort_date < start || f.cohort_date > deal.endDate) continue;
    if (f.excluded_reason === "dexpress") {
      counts.excludedDexpress++;
      continue;
    }
    if (f.excluded_reason === "deleted") {
      counts.excludedDeleted++;
      continue;
    }
    if (f.excluded_reason) continue;

    counts.received++;
    if (f.uploaded_at) counts.uploaded++;
    if (f.outcome === "delivered") counts.delivered++;
    if (f.outcome === "returned") counts.returned++;
    if (f.stage === "not_shipped") counts.notShipped++;
    if (f.stage === "in_flight") {
      counts.inFlight++;
      inFlightCount++;
      inFlightRev += toMillimes(f.expected_revenue);
    }
    if (f.outcome && !f.is_final) {
      counts.pendingBilling++;
      const evDay = f.outcome === "delivered" ? f.delivered_date : f.returned_date;
      if (evDay && evDay <= cutoffDate) {
        pendingCount++;
        pendingRev += toMillimes(f.revenue_gross);
        day(evDay).pend++;
      }
    }
    if (f.is_final && f.outcome === "delivered") {
      if (f.unit_cogs_snapshot !== null) {
        unitCogsSum += f.unit_cogs_snapshot;
        unitCogsN++;
      }
      if (f.packing_cost_snapshot !== null) {
        packSnapSum += f.packing_cost_snapshot;
        packSnapN++;
      }
      if (f.processing_cost_snapshot !== null) {
        procSnapSum += f.processing_cost_snapshot;
        procSnapN++;
      }
      if (f.quantity > 0) {
        priceSum += f.revenue / f.quantity;
        priceN++;
      }
    }
    for (const p of eventPostings(f)) {
      if (p.day > cutoffDate) continue;
      const x = day(p.day);
      x.rev += p.rev;
      x.cogs += p.cogs;
      x.dlv += p.dlv;
      x.ret += p.ret;
      x.pack += p.pack;
      x.proc += p.proc;
      x.dc += p.evD;
      x.rc += p.evR;
    }
  }

  // ── day series start..end ────────────────────────────────────────────────
  const days: DaySeriesRow[] = [];
  const T = { rev: 0, cogs: 0, dlv: 0, ret: 0, pack: 0, proc: 0, ads: 0, share: 0, dcnt: 0, rcnt: 0 };
  const Y = { rev: 0, cogs: 0, dlv: 0, ret: 0, pack: 0, proc: 0, ads: 0 };
  let cum = 0;
  let cumAtLast: number | null = null;
  let restatement = 0;

  for (let d = start; d <= end; d = addDaysISO(d, 1)) {
    const x = byDay.get(d);
    const ads = toMillimes(adSpendByDay.get(d) ?? 0);
    const rev = x?.rev ?? 0,
      cogs = x?.cogs ?? 0,
      dlv = x?.dlv ?? 0,
      ret = x?.ret ?? 0,
      pack = x?.pack ?? 0,
      proc = x?.proc ?? 0;
    const gross = rev - cogs - dlv - ret;
    const net = gross - pack - proc - ads;
    const pct = sharePctOn(terms, d);
    const share = Math.round((net * pct) / 100);
    cum += share;

    T.rev += rev;
    T.cogs += cogs;
    T.dlv += dlv;
    T.ret += ret;
    T.pack += pack;
    T.proc += proc;
    T.ads += ads;
    T.share += share;
    T.dcnt += x?.dc ?? 0;
    T.rcnt += x?.rc ?? 0;
    const y = (v: number) => Math.round((v * pct) / 100);
    Y.rev += y(rev);
    Y.cogs += y(cogs);
    Y.dlv += y(dlv);
    Y.ret += y(ret);
    Y.pack += y(pack);
    Y.proc += y(proc);
    Y.ads += y(ads);

    if (last && d <= last.periodEnd) restatement += share;
    if (last && d === last.periodEnd) cumAtLast = cum;

    days.push({
      d,
      rev: fromMillimes(rev),
      cogs: fromMillimes(cogs),
      dlv: fromMillimes(dlv),
      ret: fromMillimes(ret),
      pack: fromMillimes(pack),
      proc: fromMillimes(proc),
      ads: fromMillimes(ads),
      gross: fromMillimes(gross),
      net: fromMillimes(net),
      pct,
      share: fromMillimes(share),
      cum: fromMillimes(cum),
      dc: x?.dc ?? 0,
      rc: x?.rc ?? 0,
      pend: x?.pend ?? 0,
    });
  }

  // ── delta method ─────────────────────────────────────────────────────────
  const lastCumThrough = last ? toMillimes(last.cumulativeShareThrough) : 0;
  const unsettled = cum - lastCumThrough;
  const restatementDelta = last ? restatement - lastCumThrough : 0;
  const carriedBefore = last ? last.carriedLossAfter : 0;
  const cl = applyCarriedLoss({ unsettled: fromMillimes(unsettled), carriedBefore });

  // ── in-flight ghost: expected marginal contribution (gross margin — ads are
  // already sunk), at the deal's realized delivery rate, × today's share.
  const termsToday = currentTerms(terms);
  const sharePctToday = termsToday?.sharePct ?? 0;
  const grossMargin = T.rev > 0 ? (T.rev - T.cogs - T.dlv - T.ret) / T.rev : 0;
  const deliveredRate = counts.uploaded > 0 ? counts.delivered / counts.uploaded : 0;
  const expectedShare = Math.round(inFlightRev * deliveredRate * grossMargin * (sharePctToday / 100));

  const wf = (o: typeof Y | typeof T): Waterfall => ({
    revenue: fromMillimes(o.rev),
    cogs: fromMillimes(o.cogs),
    deliveryCost: fromMillimes(o.dlv),
    returnCost: fromMillimes(o.ret),
    packingCost: fromMillimes(o.pack),
    processingCost: fromMillimes(o.proc),
    adSpend: fromMillimes(o.ads),
    grossProfit: fromMillimes(o.rev - o.cogs - o.dlv - o.ret),
    netProfit: fromMillimes(o.rev - o.cogs - o.dlv - o.ret - o.pack - o.proc - o.ads),
  });

  void cumAtLast;

  return {
    days,
    totals: {
      ...wf(T),
      perUnit: {
        unitCogs: unitCogsN ? Math.round((unitCogsSum / unitCogsN) * 1000) / 1000 : null,
        packing: packSnapN ? Math.round((packSnapSum / packSnapN) * 1000) / 1000 : null,
        processing: procSnapN ? Math.round((procSnapSum / procSnapN) * 1000) / 1000 : null,
        deliveryAvg: T.dcnt ? Math.round((T.dlv / T.dcnt) / 10) / 100 : null,
        returnAvg: T.rcnt ? Math.round((T.ret / T.rcnt) / 10) / 100 : null,
        priceAvg: priceN ? Math.round((priceSum / priceN) * 1000) / 1000 : null,
      },
    },
    yours: wf(Y),
    cumulativeShare: fromMillimes(cum),
    unsettledShare: fromMillimes(unsettled),
    restatementDelta: fromMillimes(restatementDelta),
    carriedLossBefore: carriedBefore,
    payableNow: cl.payable,
    carriedLossAfter: cl.carriedAfter,
    lossApplied: cl.lossApplied,
    pending: { count: pendingCount, revenueGross: fromMillimes(pendingRev) },
    inFlight: { count: inFlightCount, expectedRevenue: fromMillimes(inFlightRev), expectedShare: fromMillimes(expectedShare) },
    counts,
    rates: {
      confirmed: pctOrNull(counts.uploaded, counts.received),
      delivered: pctOrNull(counts.delivered, counts.uploaded),
      returned: pctOrNull(counts.returned, counts.delivered + counts.returned),
    },
    sharePctToday,
    termsToday,
    lastStatementEnd: last?.periodEnd ?? null,
  };
}
