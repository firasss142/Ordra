import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

/**
 * GET /api/connections/overview — the Connexions › Vue d'ensemble tab.
 *
 * One payload for the whole overview: every storefront and carrier (all
 * markets for super_admin, own market for a manager), the third-party
 * services, the scheduled automations with their real last-run freshness, and
 * the 24 h event / webhook / mapping aggregates that feed the KPI strip.
 *
 * super_admin sees every market; a market_manager is scoped to their own.
 * Health is computed client-side from the raw fields (reusing the existing
 * HealthBadge helpers) so the badge logic stays in one place.
 */

const SYNC_SOURCES: { table: string; source: string; label: string; cadence: string }[] = [
  { table: "darb_sync_runs", source: "darb-sync", label: "Darb Assabil", cadence: "toutes les 15 min" },
  { table: "sheet_sync_runs", source: "google-sheets-sync", label: "Google Sheets", cadence: "toutes les 15 min" },
  { table: "ad_sync_runs", source: "meta-ads-sync", label: "Meta Ads", cadence: "toutes les heures" },
  { table: "darb_rate_harvest_runs", source: "darb-rates-harvest", label: "Darb — tarifs", cadence: "quotidien · 03:00" },
];

// Crons that don't have a run table yet — surfaced by name so the automations
// panel is complete, with freshness left null (honest, not faked).
const EXTRA_AUTOMATIONS: { source: string; label: string; cadence: string }[] = [
  { source: "poll-carriers", label: "Suivi transporteurs", cadence: "toutes les 10 min" },
  { source: "dispatch-scheduled", label: "Expédition planifiée", cadence: "toutes les 5 min" },
];

async function runCount(
  q: PromiseLike<{ count: number | null; error: unknown }>,
): Promise<number> {
  try {
    const { count } = await q;
    return count ?? 0;
  } catch {
    return 0;
  }
}

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (actor.role !== "super_admin" && actor.role !== "market_manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const marketFilter = actor.role === "super_admin" ? null : actor.market_id;
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const sfQuery = admin
    .from("storefronts")
    .select("id, market_id, platform, name, is_active, last_webhook_received_at, last_webhook_status, webhook_failure_count");
  const caQuery = admin
    .from("carriers")
    .select("id, market_id, name, code, delivery_fee, return_fee, is_active");

  const [marketsRes, sfRes, caRes, prodMap, cityMap, whMap, webhooks24h, metaAccts] = await Promise.all([
    admin.from("markets").select("id, code, name"),
    marketFilter ? sfQuery.eq("market_id", marketFilter) : sfQuery,
    marketFilter ? caQuery.eq("market_id", marketFilter) : caQuery,
    runCount(admin.from("storefront_product_mappings").select("*", { count: "exact", head: true })),
    runCount(admin.from("external_city_mappings").select("*", { count: "exact", head: true })),
    runCount(admin.from("carrier_product_mappings").select("*", { count: "exact", head: true })),
    runCount(admin.from("webhook_delivery_log").select("*", { count: "exact", head: true }).gte("created_at", since24h)),
    runCount(admin.from("meta_ad_accounts").select("*", { count: "exact", head: true })),
  ]);

  const codeByMarket = new Map((marketsRes.data ?? []).map((m) => [m.id as string, m.code as string]));
  const storefronts = (sfRes.data ?? []) as Record<string, unknown>[];
  const carriers = (caRes.data ?? []) as Record<string, unknown>[];

  // per-carrier 24h event volume + errors (all events are carrier_code-tagged)
  const carrierCodes = Array.from(new Set(carriers.map((c) => String(c.code))));
  const eventPairs = await Promise.all(
    carrierCodes.map(async (code) => {
      const [events, errors] = await Promise.all([
        runCount(admin.from("carrier_event_log").select("*", { count: "exact", head: true }).gte("created_at", since24h).eq("carrier_code", code)),
        runCount(admin.from("carrier_event_log").select("*", { count: "exact", head: true }).gte("created_at", since24h).eq("carrier_code", code).eq("outcome", "error")),
      ]);
      return [code, { events, errors }] as const;
    }),
  );
  const eventsByCode = new Map(eventPairs);
  const totalEvents24h = eventPairs.reduce((s, [, v]) => s + v.events, 0);
  const totalErrors24h = eventPairs.reduce((s, [, v]) => s + v.errors, 0);

  // sync-run freshness per source
  const syncs = await Promise.all(
    SYNC_SOURCES.map(async ({ table, source, label, cadence }) => {
      let lastRunAt: string | null = null;
      try {
        const { data } = await admin.from(table).select("started_at").order("started_at", { ascending: false }).limit(1);
        lastRunAt = (data?.[0]?.started_at as string | undefined) ?? null;
      } catch {
        lastRunAt = null;
      }
      const runs24h = await runCount(admin.from(table).select("*", { count: "exact", head: true }).gte("started_at", since24h));
      return { source, label, cadence, last_run_at: lastRunAt, runs_24h: runs24h };
    }),
  );
  const automations = [
    ...syncs,
    ...EXTRA_AUTOMATIONS.map((a) => ({ ...a, last_run_at: null as string | null, runs_24h: 0 })),
  ];

  return NextResponse.json({
    data: {
      storefronts: storefronts.map((s) => ({
        id: s.id,
        name: s.name,
        platform: s.platform,
        market_code: codeByMarket.get(String(s.market_id)) ?? null,
        is_active: s.is_active,
        last_webhook_received_at: s.last_webhook_received_at,
        last_webhook_status: s.last_webhook_status,
        webhook_failure_count: s.webhook_failure_count ?? 0,
      })),
      carriers: carriers.map((c) => ({
        id: c.id,
        name: c.name,
        code: c.code,
        market_code: codeByMarket.get(String(c.market_id)) ?? null,
        is_active: c.is_active,
        delivery_fee: c.delivery_fee,
        return_fee: c.return_fee,
        events_24h: eventsByCode.get(String(c.code))?.events ?? 0,
        errors_24h: eventsByCode.get(String(c.code))?.errors ?? 0,
      })),
      services: { meta_accounts: metaAccts },
      automations,
      kpis: {
        events_24h: totalEvents24h,
        errors_24h: totalErrors24h,
        error_rate: totalEvents24h > 0 ? Math.round((totalErrors24h / totalEvents24h) * 1000) / 10 : 0,
        webhooks_24h: webhooks24h,
        mappings_products: prodMap,
        mappings_cities: cityMap,
        mappings_warehouse: whMap,
        mappings_total: prodMap + cityMap + whMap,
      },
    },
  });
}
