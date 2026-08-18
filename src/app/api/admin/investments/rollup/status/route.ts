import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewInvestorAdmin } from "@/lib/investor-permissions";

export const dynamic = "force-dynamic";

/**
 * Rollup health for the admin "Rollup" tab: last runs, cron schedule, and
 * per-product coverage (billing, pending, in flight, Dexpress excluded).
 * A silent failure must never read as "nothing happened".
 */
export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (!canViewInvestorAdmin(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const [runsRes, cronRes, dealsRes] = await Promise.all([
    admin
      .from("investor_rollup_runs")
      .select("id, trigger, mode, product_id, status, started_at, finished_at, watermark_from, watermark_to, orders_scanned, facts_changed, days_written, deals_snapshotted, excluded_dexpress, error")
      .order("started_at", { ascending: false })
      .limit(30),
    admin.rpc("investor_rollup_cron_status"),
    admin
      .from("investor_deals")
      .select("product_id, market_id, start_date, status, products(name, image_url)")
      .neq("status", "closed"),
  ]);

  if (runsRes.error) {
    console.error("[GET rollup/status] runs", runsRes.error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  type DealRow = { product_id: string; market_id: string; start_date: string; status: string; products: { name: string; image_url: string | null } | null };
  let deals = (dealsRes.data ?? []) as unknown as DealRow[];
  if (actor.role === "market_manager") deals = deals.filter((d) => d.market_id === actor.market_id);
  const productIds = [...new Set(deals.map((d) => d.product_id))];

  // Coverage per product from the facts.
  const coverage: Record<string, unknown>[] = [];
  for (const pid of productIds) {
    const d = deals.find((x) => x.product_id === pid)!;
    const minStart = deals.filter((x) => x.product_id === pid).map((x) => x.start_date).sort()[0];
    const { data: facts } = await admin
      .from("investor_order_facts")
      .select("outcome, is_final, stage, excluded_reason, updated_at")
      .eq("product_id", pid)
      .gte("cohort_date", minStart);
    type F = { outcome: string | null; is_final: boolean; stage: string; excluded_reason: string | null; updated_at: string };
    const rows = (facts ?? []) as F[];
    let outcomes = 0, finalOutcomes = 0, pending = 0, inFlight = 0, dexpress = 0, received = 0, latest: string | null = null;
    for (const f of rows) {
      if (f.updated_at && (!latest || f.updated_at > latest)) latest = f.updated_at;
      if (f.excluded_reason === "dexpress") { dexpress++; continue; }
      if (f.excluded_reason) continue;
      received++;
      if (f.outcome) { outcomes++; if (f.is_final) finalOutcomes++; else pending++; }
      if (f.stage === "in_flight") inFlight++;
    }
    coverage.push({
      product_id: pid,
      product_name: d.products?.name ?? null,
      image_url: d.products?.image_url ?? null,
      market_id: d.market_id,
      facts_as_of: latest,
      received,
      outcomes,
      final_outcomes: finalOutcomes,
      pending_billing: pending,
      in_flight: inFlight,
      excluded_dexpress: dexpress,
    });
  }

  const runs = runsRes.data ?? [];
  const lastOk = (runs as { status: string; finished_at: string | null }[]).find((r) => r.status === "succeeded" || r.status === "partial");

  return NextResponse.json(
    {
      data: {
        last_success_at: lastOk?.finished_at ?? null,
        runs,
        cron: cronRes.error ? [] : (cronRes.data ?? []),
        coverage,
      },
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
