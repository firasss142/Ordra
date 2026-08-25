import { NextRequest, NextResponse } from "next/server";
import { adminReader, adminWriter, ISO_DATE, NO_STORE, rpcError } from "@/lib/investors/admin-route";
import { previewSettlements } from "@/lib/investors/settlement-preview";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { runInvestorRollup } from "@/lib/investors/rollup-run";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Settled statements (manager: own market). ?deal_id= | ?investor_id= */
export async function GET(req: NextRequest) {
  const g = await adminReader(req);
  if ("response" in g) return g.response;
  const sp = req.nextUrl.searchParams;
  let q = g.admin.from("investor_deal_statements").select("*, investor_deals!investor_deal_statements_deal_id_fkey(label, products(name, image_url)), investors(legal_name)").order("settled_at", { ascending: false }).limit(200);
  if (g.actor.role === "market_manager") q = q.eq("market_id", g.actor.market_id ?? "");
  if (sp.get("deal_id")) q = q.eq("deal_id", sp.get("deal_id")!);
  if (sp.get("investor_id")) q = q.eq("investor_id", sp.get("investor_id")!);
  const rows = await fetchAllRows(q);
  return NextResponse.json({ data: rows }, { headers: NO_STORE });
}

/**
 * Commit. Body: { drafts: [{ deal_id, period_end, preview_hash }] }.
 * Every draft is RECOMPUTED here; a hash mismatch → 409 PREVIEW_STALE (facts
 * moved since the preview — re-preview). Then one atomic RPC across deals.
 */
export async function POST(req: NextRequest) {
  const g = await adminWriter(req);
  if ("response" in g) return g.response;
  let b: { drafts?: unknown };
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const reqs = Array.isArray(b.drafts) ? (b.drafts as { deal_id?: unknown; period_end?: unknown; preview_hash?: unknown }[]) : [];
  if (!reqs.length) return NextResponse.json({ error: "drafts required" }, { status: 400 });
  const periodEnd = String(reqs[0].period_end ?? "");
  if (!ISO_DATE.test(periodEnd) || reqs.some((r) => r.period_end !== periodEnd)) return NextResponse.json({ error: "all drafts must share one valid period_end" }, { status: 400 });
  const dealIds = reqs.map((r) => String(r.deal_id ?? ""));

  const { drafts } = await previewSettlements(g.admin, dealIds, periodEnd);
  const stale = drafts.filter((d) => d.error || d.preview_hash !== reqs.find((r) => r.deal_id === d.deal_id)?.preview_hash);
  if (stale.length) {
    return NextResponse.json({ error: "PREVIEW_STALE", code: "PREVIEW_STALE", deals: stale.map((d) => ({ deal_id: d.deal_id, reason: d.error ?? "hash mismatch" })) }, { status: 409 });
  }
  const payload = drafts.map(({ warnings: _w, product_name: _p, image_url: _i, investor_name: _n, investor_id: _inv, currency: _c, error: _e, ...rest }) => rest);
  const { data, error } = await g.admin.rpc("commit_investor_settlements", { p_statements: payload, p_actor_id: g.actor.id });
  if (error) return rpcError(error, "[POST settlements]");
  // Snapshots must reflect the new statement immediately (unsettled resets).
  await runInvestorRollup(g.admin, { trigger: "manual", mode: "incremental" });
  return NextResponse.json({ data }, { status: 201 });
}
