import { fromMillimes, toMillimes } from "@/lib/calculations/math";
import type { OrderFactRow } from "./order-facts";

/**
 * Per-(product, local day) projection of the order facts.
 *
 * Two families keyed by the same day:
 *  - COHORT: orders CREATED that day, outcome as of now (funnel, rates);
 *  - EVENT:  money that LANDED that day, final rows only, by the two-posting
 *            rule: P1 @ delivered_date {+revenue_gross,+cogs,+delivery,+packing,
 *            +processing}; P2 @ returned_date {−revenue_gross,−cogs,−delivery
 *            if reversal_applies; +return; +packing,+processing if no P1}.
 *            The two postings sum to the fact's final figures and draw the dip
 *            on the return day.
 *  - CALENDAR: product-mapped ad spend prorated per day (given as input).
 */

export interface DailyFactRow {
  product_id: string;
  market_id: string;
  fact_date: string;
  received_count: number;
  excluded_dexpress_count: number;
  excluded_deleted_count: number;
  uploaded_count: number;
  delivered_count: number;
  returned_count: number;
  in_flight_count: number;
  not_shipped_count: number;
  pending_billing_count: number;
  in_flight_expected_revenue: number;
  ev_delivered_count: number;
  ev_returned_count: number;
  revenue: number;
  cogs: number;
  delivery_cost: number;
  return_cost: number;
  packing_cost: number;
  processing_cost: number;
  gross_profit: number;
  net_profit_before_ads: number;
  pending_revenue: number;
  pending_count: number;
  ad_spend_direct: number;
}

type Acc = {
  market_id: string;
  received: number;
  exDex: number;
  exDel: number;
  uploaded: number;
  delivered: number;
  returned: number;
  inFlight: number;
  notShipped: number;
  pendingBilling: number;
  inFlightRev: number;
  evD: number;
  evR: number;
  rev: number;
  cogs: number;
  dlv: number;
  ret: number;
  pack: number;
  proc: number;
  pendRev: number;
  pendN: number;
};

function blank(marketId: string): Acc {
  return {
    market_id: marketId,
    received: 0,
    exDex: 0,
    exDel: 0,
    uploaded: 0,
    delivered: 0,
    returned: 0,
    inFlight: 0,
    notShipped: 0,
    pendingBilling: 0,
    inFlightRev: 0,
    evD: 0,
    evR: 0,
    rev: 0,
    cogs: 0,
    dlv: 0,
    ret: 0,
    pack: 0,
    proc: 0,
    pendRev: 0,
    pendN: 0,
  };
}

/** Postings a single fact contributes to event days (integer millimes). */
export function eventPostings(f: OrderFactRow): { day: string; evD: number; evR: number; rev: number; cogs: number; dlv: number; ret: number; pack: number; proc: number }[] {
  if (!f.is_final || f.excluded_reason || !f.outcome) return [];
  const out: ReturnType<typeof eventPostings> = [];
  const revG = toMillimes(f.revenue_gross);
  const cogsFull = f.outcome === "delivered" ? toMillimes(f.cogs) : toMillimes((f.unit_cogs_snapshot ?? 0) * f.quantity);
  const dlvFull = f.outcome === "delivered" ? toMillimes(f.delivery_cost) : 0;
  const pack = toMillimes(f.packing_cost);
  const proc = toMillimes(f.processing_cost);

  if (f.outcome === "delivered" && f.delivered_date) {
    out.push({ day: f.delivered_date, evD: 1, evR: 0, rev: revG, cogs: cogsFull, dlv: dlvFull, ret: 0, pack, proc });
    return out;
  }
  // returned
  const hadP1 = f.reversal_applies && !!f.delivered_date;
  if (hadP1 && f.delivered_date) {
    // The parcel was delivered first: P1 booked it, P2 reverses it.
    // Delivery cost on a delivered-then-returned parcel: return cost only, so
    // P1's delivery is reversed too. We do not know P1's delivery amount from
    // the fact (return replaced it), so book P1 with 0 delivery and reverse 0.
    out.push({ day: f.delivered_date, evD: 1, evR: 0, rev: revG, cogs: cogsFull, dlv: 0, ret: 0, pack, proc });
    out.push({ day: f.returned_date!, evD: 0, evR: 1, rev: -revG, cogs: -cogsFull, dlv: 0, ret: toMillimes(f.return_cost), pack: 0, proc: 0 });
  } else if (f.returned_date) {
    out.push({ day: f.returned_date, evD: 0, evR: 1, rev: 0, cogs: 0, dlv: 0, ret: toMillimes(f.return_cost), pack, proc });
  }
  return out;
}

/**
 * Build daily rows for a set of facts. `days` restricts output to those
 * (product_id, fact_date) keys when provided; otherwise every touched key is
 * emitted. `adSpend` is productId → day → currency units.
 */
export function buildDailyFacts(params: {
  facts: OrderFactRow[];
  adSpend: Map<string, Map<string, number>>;
  keys?: Set<string>; // `${product_id}|${fact_date}`
}): DailyFactRow[] {
  const acc = new Map<string, Acc>(); // key → acc
  const get = (pid: string, day: string, marketId: string) => {
    const k = `${pid}|${day}`;
    let a = acc.get(k);
    if (!a) {
      a = blank(marketId);
      acc.set(k, a);
    }
    return a;
  };

  for (const f of params.facts) {
    if (!f.product_id) continue;
    // Cohort family
    const c = get(f.product_id, f.cohort_date, f.market_id);
    if (f.excluded_reason === "dexpress") c.exDex++;
    else if (f.excluded_reason === "deleted") c.exDel++;
    else if (f.excluded_reason === null) {
      c.received++;
      if (f.uploaded_at) c.uploaded++;
      if (f.outcome === "delivered") c.delivered++;
      if (f.outcome === "returned") c.returned++;
      if (f.stage === "in_flight") {
        c.inFlight++;
        c.inFlightRev += toMillimes(f.expected_revenue);
      }
      if (f.stage === "not_shipped") c.notShipped++;
      if (f.outcome && !f.is_final) c.pendingBilling++;
    }
    // Event family
    for (const p of eventPostings(f)) {
      const e = get(f.product_id, p.day, f.market_id);
      e.evD += p.evD;
      e.evR += p.evR;
      e.rev += p.rev;
      e.cogs += p.cogs;
      e.dlv += p.dlv;
      e.ret += p.ret;
      e.pack += p.pack;
      e.proc += p.proc;
    }
    // Pending bucket on the event day
    if (!f.excluded_reason && f.outcome && !f.is_final) {
      const day = f.outcome === "delivered" ? f.delivered_date : f.returned_date;
      if (day) {
        const e = get(f.product_id, day, f.market_id);
        e.pendN++;
        e.pendRev += toMillimes(f.revenue_gross);
      }
    }
  }

  // Calendar family — ad spend days (only for products present or requested)
  for (const [pid, byDay] of params.adSpend) {
    for (const [day] of byDay) {
      const k = `${pid}|${day}`;
      if (params.keys && !params.keys.has(k)) continue;
      if (!acc.has(k)) {
        // market id unknown from ad spend alone; take it from any fact of the product
        const anyFact = params.facts.find((f) => f.product_id === pid);
        if (!anyFact) continue;
        acc.set(k, blank(anyFact.market_id));
      }
    }
  }

  const rows: DailyFactRow[] = [];
  for (const [k, a] of acc) {
    if (params.keys && !params.keys.has(k)) continue;
    const [pid, day] = k.split("|");
    const ads = params.adSpend.get(pid)?.get(day) ?? 0;
    const gross = a.rev - a.cogs - a.dlv - a.ret;
    const netBefore = gross - a.pack - a.proc;
    rows.push({
      product_id: pid,
      market_id: a.market_id,
      fact_date: day,
      received_count: a.received,
      excluded_dexpress_count: a.exDex,
      excluded_deleted_count: a.exDel,
      uploaded_count: a.uploaded,
      delivered_count: a.delivered,
      returned_count: a.returned,
      in_flight_count: a.inFlight,
      not_shipped_count: a.notShipped,
      pending_billing_count: a.pendingBilling,
      in_flight_expected_revenue: fromMillimes(a.inFlightRev),
      ev_delivered_count: a.evD,
      ev_returned_count: a.evR,
      revenue: fromMillimes(a.rev),
      cogs: fromMillimes(a.cogs),
      delivery_cost: fromMillimes(a.dlv),
      return_cost: fromMillimes(a.ret),
      packing_cost: fromMillimes(a.pack),
      processing_cost: fromMillimes(a.proc),
      gross_profit: fromMillimes(gross),
      net_profit_before_ads: fromMillimes(netBefore),
      pending_revenue: fromMillimes(a.pendRev),
      pending_count: a.pendN,
      ad_spend_direct: ads,
    });
  }
  return rows;
}

/** All (product_id, day) keys a fact touches (cohort + event days). */
export function touchedKeys(f: OrderFactRow): string[] {
  const keys = new Set<string>();
  if (!f.product_id) return [];
  keys.add(`${f.product_id}|${f.cohort_date}`);
  if (f.delivered_date) keys.add(`${f.product_id}|${f.delivered_date}`);
  if (f.returned_date) keys.add(`${f.product_id}|${f.returned_date}`);
  return [...keys];
}
