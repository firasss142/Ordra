/**
 * Per-market aggregation for the Système › Marchés workspace.
 *
 * Pure function so it is unit-testable without a database: the route fetches
 * the raw rows (orders / agents / storefronts / carriers) and hands them here.
 *
 * "Confirmed reach" means the order has *ever* been confirmed — every status at
 * or past `confirmed` in the OMS pipeline — so the funnel reçues → confirmées →
 * livrées is cumulative, matching the prototype's waterfall.
 */

export const ONLINE_MINUTES = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Statuses that imply the order was confirmed at some point. */
const CONFIRMED_REACH = new Set([
  "confirmed",
  "uploaded",
  "scanned",
  "dispatch_scheduled",
  "dispatched",
  "deposit",
  "in_transit",
  "delivered",
  "returned",
]);

export interface WindowStats {
  received: number;
  confirmed: number;
  delivered: number;
}

export interface CrossMarketMetrics {
  market_id: string;
  window_7d: WindowStats;
  window_30d: WindowStats;
  orders_today: number;
  confirmation_rate_7d: number;
  delivery_rate_30d: number;
  agents_online: number;
  agents_active: number;
  storefronts_total: number;
  storefronts_active: number;
  carriers_total: number;
  carriers_active: number;
  last_order_at: string | null;
  spark_7d: number[];
}

interface OrderRow {
  market_id: string;
  status: string;
  created_at: string;
}
interface AgentRow {
  market_id: string;
  is_active: boolean;
  last_seen_at: string | null;
}
interface ConnRow {
  market_id: string;
  is_active: boolean;
}

interface Input {
  now: Date;
  marketIds: string[];
  orders: OrderRow[];
  agents: AgentRow[];
  storefronts: ConnRow[];
  carriers: ConnRow[];
  /**
   * True last-order timestamp per market, from a query NOT bounded by the 30-day
   * window — otherwise a dormant market (last order weeks ago) reports null and
   * the card can't tell "in sommeil" from "brand new". Optional: falls back to
   * the newest in-window order when absent.
   */
  lastOrderByMarket?: Record<string, string | null>;
}

function pct(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function startOfUtcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function computeCrossMarketMetrics(input: Input): CrossMarketMetrics[] {
  const { now, marketIds, orders, agents, storefronts, carriers, lastOrderByMarket } = input;
  const nowMs = now.getTime();
  const cut7d = nowMs - 7 * DAY_MS;
  const cut30d = nowMs - 30 * DAY_MS;
  const todayStart = startOfUtcDay(now);
  const onlineCut = nowMs - ONLINE_MINUTES * 60 * 1000;

  return marketIds.map((market_id) => {
    const w7: WindowStats = { received: 0, confirmed: 0, delivered: 0 };
    const w30: WindowStats = { received: 0, confirmed: 0, delivered: 0 };
    const spark = new Array(7).fill(0) as number[];
    let ordersToday = 0;
    let lastOrderMs = -Infinity;
    let lastOrderIso: string | null = null;

    for (const o of orders) {
      if (o.market_id !== market_id) continue;
      const t = new Date(o.created_at).getTime();
      if (Number.isNaN(t)) continue;

      if (t > lastOrderMs) {
        lastOrderMs = t;
        lastOrderIso = o.created_at;
      }

      const confirmed = CONFIRMED_REACH.has(o.status);
      const delivered = o.status === "delivered";

      if (t >= cut30d) {
        w30.received++;
        if (confirmed) w30.confirmed++;
        if (delivered) w30.delivered++;
      }
      if (t >= cut7d) {
        w7.received++;
        if (confirmed) w7.confirmed++;
        if (delivered) w7.delivered++;
        // daily sparkline slot: 0 = 6 days ago … 6 = today
        const dayOffset = Math.floor((todayStart - startOfUtcDay(new Date(t))) / DAY_MS);
        if (dayOffset >= 0 && dayOffset <= 6) spark[6 - dayOffset]++;
      }
      if (t >= todayStart) ordersToday++;
    }

    let agentsActive = 0;
    let agentsOnline = 0;
    for (const a of agents) {
      if (a.market_id !== market_id || !a.is_active) continue;
      agentsActive++;
      if (a.last_seen_at && new Date(a.last_seen_at).getTime() >= onlineCut) agentsOnline++;
    }

    const sfHere = storefronts.filter((s) => s.market_id === market_id);
    const caHere = carriers.filter((c) => c.market_id === market_id);

    return {
      market_id,
      window_7d: w7,
      window_30d: w30,
      orders_today: ordersToday,
      confirmation_rate_7d: pct(w7.confirmed, w7.received),
      // COD delivery rate: of the orders that reached confirmation, how many
      // were delivered. Dividing by received would conflate confirmation loss
      // with delivery loss and understate carrier performance.
      delivery_rate_30d: pct(w30.delivered, w30.confirmed),
      agents_online: agentsOnline,
      agents_active: agentsActive,
      storefronts_total: sfHere.length,
      storefronts_active: sfHere.filter((s) => s.is_active).length,
      carriers_total: caHere.length,
      carriers_active: caHere.filter((c) => c.is_active).length,
      last_order_at: lastOrderByMarket?.[market_id] ?? lastOrderIso,
      spark_7d: spark,
    };
  });
}
