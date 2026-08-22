/**
 * Verify the Marchés cards against live data by running the EXACT aggregation
 * the /api/metrics/cross-market route runs, and printing what each card will
 * render. Read-only. Proves the "all values are 0" bug is fixed (and shows
 * which zeros are real, e.g. a dormant market).
 *
 *   node_modules/.bin/vite-node scripts/verify-market-metrics.ts
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { computeCrossMarketMetrics } from "../src/lib/cross-market-metrics";

// minimal .env.local loader (no dotenv dependency)
for (const line of readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const now = new Date();
  const cut30dIso = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [markets, orders, agents, sf, ca] = await Promise.all([
    admin.from("markets").select("id, code, name").eq("is_active", true).order("code"),
    admin.from("orders").select("market_id, status, created_at").gte("created_at", cut30dIso).limit(50000),
    admin.from("users").select("market_id, is_active, last_seen_at").eq("role", "agent"),
    admin.from("storefronts").select("market_id, is_active"),
    admin.from("carriers").select("market_id, is_active"),
  ]);

  const nameByMarket = new Map((markets.data ?? []).map((m) => [m.id as string, m.code as string]));

  const lastOrderPairs = await Promise.all(
    (markets.data ?? []).map(async (m) => {
      const { data } = await admin.from("orders").select("created_at").eq("market_id", m.id).order("created_at", { ascending: false }).limit(1);
      return [m.id as string, (data?.[0]?.created_at as string | undefined) ?? null] as const;
    }),
  );

  const metrics = computeCrossMarketMetrics({
    now,
    marketIds: (markets.data ?? []).map((m) => m.id as string),
    orders: (orders.data ?? []) as never,
    agents: (agents.data ?? []) as never,
    storefronts: (sf.data ?? []) as never,
    carriers: (ca.data ?? []) as never,
    lastOrderByMarket: Object.fromEntries(lastOrderPairs),
  });

  console.log(`\nMarchés cards — live figures @ ${now.toISOString().slice(0, 16)}\n${"=".repeat(60)}`);
  for (const m of metrics) {
    const code = (nameByMarket.get(m.market_id) ?? m.market_id).toUpperCase();
    console.log(`\n${code}`);
    console.log(`  Commandes 7j   : ${m.window_7d.received}  (conf ${m.window_7d.confirmed} · livrées ${m.window_7d.delivered})`);
    console.log(`  Commandes 30j  : ${m.window_30d.received}  (conf ${m.window_30d.confirmed} · livrées ${m.window_30d.delivered})`);
    console.log(`  Aujourd'hui    : ${m.orders_today}`);
    console.log(`  Confirmation 7j: ${m.confirmation_rate_7d}%   Livraison 30j: ${m.delivery_rate_30d}%`);
    console.log(`  Agents         : ${m.agents_online} en ligne / ${m.agents_active} actifs`);
    console.log(`  Connexions     : ${m.storefronts_active + m.carriers_active}/${m.storefronts_total + m.carriers_total}  (${m.storefronts_total} SF · ${m.carriers_total} transp.)`);
    console.log(`  Dernière cmd   : ${m.last_order_at?.slice(0, 10) ?? "—"}`);
    console.log(`  Spark 7j       : [${m.spark_7d.join(", ")}]`);
    const allZero = m.window_30d.received === 0;
    console.log(`  → ${allZero ? "DORMANT (real zero — insight 'en sommeil')" : "ACTIVE — real numbers render"}`);
  }
  console.log();
}

main().catch((e) => { console.error(e); process.exit(1); });
