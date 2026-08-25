import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { marketTimezone } from "@/lib/markets";
import { computeDealAccrual } from "./accrual";
import { addDaysISO, adSpendByProductDay, eachDayISO, type AdSpendRow } from "./facts/ad-spend-daily";
import { buildDailyFacts, type DailyFactRow } from "./facts/daily-facts";
import { loadAndPersistOrderFacts, loadProductFacts } from "./facts/load-order-facts";
import { localDateISO } from "./facts/order-facts";
import { loadDealAccrualInput, type DealRow } from "./load-accrual";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supa = SupabaseClient<any, any, any>;

export type RollupTrigger = "cron" | "manual";
export type RollupMode = "incremental" | "full";

export interface RollupRunResult {
  runId: string | null;
  status: "succeeded" | "partial" | "failed" | "skipped_locked" | "noop";
  mode: RollupMode;
  productIds: string[];
  watermarkFrom: string | null;
  watermarkTo: string;
  ordersScanned: number;
  factsChanged: number;
  daysWritten: number;
  dealsSnapshotted: number;
  excludedDexpress: number;
  errors: string[];
}

const WATERMARK_OVERLAP_MS = 5 * 60 * 1000;
const AD_RESTATEMENT_DAYS = 7;
const DEFAULT_LOOKBACK_HOURS = 48;

interface DealProduct {
  productId: string;
  marketId: string;
  minStart: string;
}

async function loadOpenDeals(admin: Supa, productId?: string | null): Promise<DealRow[]> {
  let q = admin
    .from("investor_deals")
    .select("id, investor_id, product_id, market_id, currency, label, start_date, end_date, status, close_reason, closed_at")
    .neq("status", "closed");
  if (productId) q = q.eq("product_id", productId);
  return fetchAllRows<DealRow>(q);
}

function dealProducts(deals: DealRow[]): DealProduct[] {
  const m = new Map<string, DealProduct>();
  for (const d of deals) {
    const cur = m.get(d.product_id);
    if (!cur) m.set(d.product_id, { productId: d.product_id, marketId: d.market_id, minStart: d.start_date });
    else if (d.start_date < cur.minStart) cur.minStart = d.start_date;
  }
  return [...m.values()];
}

async function lastWatermark(admin: Supa): Promise<string | null> {
  const { data } = await admin
    .from("investor_rollup_runs")
    .select("watermark_to")
    .in("status", ["succeeded", "partial"])
    .eq("mode", "incremental")
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { watermark_to: string | null } | null)?.watermark_to ?? null;
}

/** Candidate order ids for an incremental run: anything that moved since `since`. */
async function incrementalCandidates(admin: Supa, since: string, productIds: string[]): Promise<string[]> {
  const ids = new Set<string>();
  const [o1, o2, h, s] = await Promise.all([
    fetchAllRows<{ id: string }>(admin.from("orders").select("id").in("product_id", productIds).gt("updated_at", since)),
    fetchAllRows<{ order_id: string }>(admin.from("order_items").select("order_id").in("product_id", productIds).gt("updated_at", since)),
    fetchAllRows<{ order_id: string; orders: { product_id: string | null } | null }>(
      admin.from("order_history").select("order_id, orders!inner(product_id)").in("orders.product_id", productIds).gt("created_at", since),
    ),
    fetchAllRows<{ order_id: string; orders: { product_id: string | null } | null }>(
      admin.from("darb_shipments").select("order_id, orders!inner(product_id)").in("orders.product_id", productIds).gt("updated_at", since),
    ),
  ]);
  for (const r of o1) ids.add(r.id);
  for (const r of o2) ids.add(r.order_id);
  for (const r of h) ids.add(r.order_id);
  for (const r of s) ids.add(r.order_id);
  return [...ids];
}

/** Every order of a product since the earliest deal start (UTC day − 1 for tz slack). */
async function fullCandidates(admin: Supa, productId: string, minStart: string): Promise<string[]> {
  const sinceIso = addDaysISO(minStart, -1) + "T00:00:00Z";
  const [a, b] = await Promise.all([
    fetchAllRows<{ id: string }>(admin.from("orders").select("id").eq("product_id", productId).gte("created_at", sinceIso)),
    fetchAllRows<{ order_id: string }>(admin.from("order_items").select("order_id").eq("product_id", productId).gte("created_at", sinceIso)),
  ]);
  return [...new Set([...a.map((r) => r.id), ...b.map((r) => r.order_id)])];
}

async function loadAdSpendRows(admin: Supa, productIds: string[]): Promise<AdSpendRow[]> {
  const rows = await fetchAllRows<{ product_id: string | null; amount: string | number; period_start: string; period_end: string }>(
    admin.from("ad_spend").select("product_id, amount, period_start, period_end").in("product_id", productIds).eq("is_active", true),
  );
  return rows.map((r) => ({ productId: r.product_id, amount: Number(r.amount), periodStart: r.period_start, periodEnd: r.period_end }));
}

async function upsertDaily(admin: Supa, rows: DailyFactRow[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await admin.from("investor_daily_product_facts").upsert(chunk, { onConflict: "product_id,fact_date" });
    if (error) throw new Error(`investor_daily_product_facts upsert: ${error.message}`);
    n += chunk.length;
  }
  return n;
}

/**
 * Rebuild daily rows for the given (product|day) keys, plus (incremental)
 * the trailing ad-restatement window for every deal product.
 */
async function rebuildDaily(
  admin: Supa,
  products: DealProduct[],
  keys: Set<string>,
  mode: RollupMode,
  todayByMarket: Map<string, string>,
): Promise<number> {
  const adRows = await loadAdSpendRows(admin, products.map((p) => p.productId));
  const adByProductDay = adSpendByProductDay(adRows);
  const allKeys = new Set(keys);
  if (mode === "incremental") {
    for (const p of products) {
      const today = todayByMarket.get(p.marketId) ?? new Date().toISOString().slice(0, 10);
      for (const d of eachDayISO(addDaysISO(today, -AD_RESTATEMENT_DAYS), today)) allKeys.add(`${p.productId}|${d}`);
    }
  } else {
    for (const p of products) {
      const today = todayByMarket.get(p.marketId) ?? new Date().toISOString().slice(0, 10);
      for (const d of eachDayISO(p.minStart, today)) allKeys.add(`${p.productId}|${d}`);
    }
  }
  const touchedProducts = new Set([...allKeys].map((k) => k.split("|")[0]));
  let written = 0;
  for (const pid of touchedProducts) {
    const p = products.find((x) => x.productId === pid);
    if (!p) continue;
    const facts = await loadProductFacts(admin, pid, addDaysISO(p.minStart, -1));
    const keysForProduct = new Set([...allKeys].filter((k) => k.startsWith(pid + "|")));
    const ad = new Map<string, Map<string, number>>();
    if (adByProductDay.get(pid)) ad.set(pid, adByProductDay.get(pid)!);
    let rows = buildDailyFacts({ facts, adSpend: ad, keys: keysForProduct });
    // Emit zero rows for requested days that have no facts and no ads, so a
    // sparkline never draws a line between non-adjacent dates.
    const have = new Set(rows.map((r) => `${r.product_id}|${r.fact_date}`));
    for (const k of keysForProduct) {
      if (have.has(k)) continue;
      const [, day] = k.split("|");
      rows.push({
        product_id: pid,
        market_id: p.marketId,
        fact_date: day,
        received_count: 0,
        excluded_dexpress_count: 0,
        excluded_deleted_count: 0,
        uploaded_count: 0,
        delivered_count: 0,
        returned_count: 0,
        in_flight_count: 0,
        not_shipped_count: 0,
        pending_billing_count: 0,
        in_flight_expected_revenue: 0,
        ev_delivered_count: 0,
        ev_returned_count: 0,
        revenue: 0,
        cogs: 0,
        delivery_cost: 0,
        return_cost: 0,
        packing_cost: 0,
        processing_cost: 0,
        gross_profit: 0,
        net_profit_before_ads: 0,
        pending_revenue: 0,
        pending_count: 0,
        ad_spend_direct: 0,
      });
    }
    rows = rows.filter((r) => r.market_id);
    written += await upsertDaily(admin, rows);
  }
  return written;
}

async function snapshotDeals(admin: Supa, deals: DealRow[], runId: string | null, todayByMarket: Map<string, string>): Promise<{ n: number; errors: string[] }> {
  let n = 0;
  const errors: string[] = [];
  for (const d of deals) {
    try {
      const today = todayByMarket.get(d.market_id) ?? new Date().toISOString().slice(0, 10);
      const input = await loadDealAccrualInput(admin, d, today, today);
      const r = computeDealAccrual(input);
      let watermark: string | null = null;
      for (const f of input.facts as ({ updated_at?: string })[]) {
        if (f.updated_at && (!watermark || f.updated_at > watermark)) watermark = f.updated_at;
      }
      const { error } = await admin.from("investor_deal_snapshots").upsert(
        {
          deal_id: d.id,
          as_of: new Date().toISOString(),
          rollup_run_id: runId,
          facts_watermark: watermark,
          cumulative_share: r.cumulativeShare,
          unsettled_share: r.unsettledShare,
          payable_now: r.payableNow,
          carried_loss_before: r.carriedLossBefore,
          carried_loss_after: r.carriedLossAfter,
          restatement_delta: r.restatementDelta,
          totals: r.totals,
          yours: r.yours,
          series: r.days,
          pending: r.pending,
          in_flight: r.inFlight,
          rates: r.rates,
          counts: r.counts,
          excluded: { dexpress: r.counts.excludedDexpress, deleted: r.counts.excludedDeleted },
          terms_current: r.termsToday ?? {},
        },
        { onConflict: "deal_id" },
      );
      if (error) throw new Error(error.message);
      n++;
      // Maturity flip
      if (d.status === "active" && today > d.end_date) {
        await admin.from("investor_deals").update({ status: "matured" }).eq("id", d.id).eq("status", "active");
      }
    } catch (e) {
      errors.push(`snapshot ${d.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { n, errors };
}

/**
 * Run the investor v2 rollup.
 *  - incremental: orders that moved since the last watermark (−5 min overlap),
 *    restricted to deal products; rebuild touched days + trailing 7 ad days;
 *    snapshot every open deal.
 *  - full: every order of `productId` (or of all deal products) since the
 *    earliest open deal start; rebuild every day; snapshot the deals.
 */
export async function runInvestorRollup(
  admin: Supa,
  opts: { trigger: RollupTrigger; mode: RollupMode; productId?: string | null },
): Promise<RollupRunResult> {
  const nowIso = new Date().toISOString();
  const base: RollupRunResult = {
    runId: null,
    status: "noop",
    mode: opts.mode,
    productIds: [],
    watermarkFrom: null,
    watermarkTo: nowIso,
    ordersScanned: 0,
    factsChanged: 0,
    daysWritten: 0,
    dealsSnapshotted: 0,
    excludedDexpress: 0,
    errors: [],
  };

  const { data: claimed, error: claimErr } = await admin.rpc("claim_investor_rollup_run", {
    p_trigger: opts.trigger,
    p_mode: opts.mode,
    p_product_id: opts.productId ?? null,
  });
  if (claimErr) {
    base.status = "failed";
    base.errors.push(`claim: ${claimErr.message}`);
    return base;
  }
  const runId = (claimed as string | null) ?? null;
  if (!runId) {
    base.status = "skipped_locked";
    return base;
  }
  base.runId = runId;

  const finish = async (status: RollupRunResult["status"], error?: string) => {
    await admin.rpc("finish_investor_rollup_run", {
      p_id: runId,
      p_status: status === "noop" ? "succeeded" : status,
      p_watermark_from: base.watermarkFrom,
      p_watermark_to: base.watermarkTo,
      p_orders_scanned: base.ordersScanned,
      p_facts_changed: base.factsChanged,
      p_days_written: base.daysWritten,
      p_deals_snapshotted: base.dealsSnapshotted,
      p_excluded_dexpress: base.excludedDexpress,
      p_error: error ?? (base.errors.length ? base.errors.join("; ").slice(0, 2000) : null),
    });
  };

  try {
    const deals = await loadOpenDeals(admin, opts.productId ?? null);
    const products = dealProducts(deals);
    base.productIds = products.map((p) => p.productId);
    if (products.length === 0) {
      base.status = "succeeded";
      await finish("succeeded");
      return base;
    }
    const todayByMarket = new Map<string, string>();
    for (const p of products) todayByMarket.set(p.marketId, localDateISO(nowIso, marketTimezone(p.marketId)));

    // 1. candidates
    let candidates: string[] = [];
    if (opts.mode === "incremental") {
      const wm = await lastWatermark(admin);
      const since = wm
        ? new Date(new Date(wm).getTime() - WATERMARK_OVERLAP_MS).toISOString()
        : new Date(Date.now() - DEFAULT_LOOKBACK_HOURS * 3600 * 1000).toISOString();
      base.watermarkFrom = since;
      candidates = await incrementalCandidates(admin, since, base.productIds);
    } else {
      for (const p of products) candidates.push(...(await fullCandidates(admin, p.productId, p.minStart)));
      candidates = [...new Set(candidates)];
    }

    // 2. facts
    const persisted = await loadAndPersistOrderFacts(admin, candidates);
    base.ordersScanned = persisted.scanned;
    base.factsChanged = persisted.changed;
    base.excludedDexpress = persisted.excludedDexpress;

    // 3. daily projection
    base.daysWritten = await rebuildDaily(admin, products, persisted.touched, opts.mode, todayByMarket);

    // 4. snapshots (+ maturity flip)
    const snap = await snapshotDeals(admin, deals, runId, todayByMarket);
    base.dealsSnapshotted = snap.n;
    base.errors.push(...snap.errors);

    base.status = base.errors.length ? "partial" : "succeeded";
    await finish(base.status);
    return base;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    base.errors.push(msg);
    base.status = "failed";
    await finish("failed", msg);
    return base;
  }
}
