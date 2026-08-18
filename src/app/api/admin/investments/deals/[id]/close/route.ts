import { NextRequest, NextResponse } from "next/server";
import { adminWriter, ISO_DATE, rpcError } from "@/lib/investors/admin-route";
import { previewSettlements } from "@/lib/investors/settlement-preview";
import { runInvestorRollup } from "@/lib/investors/rollup-run";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Body: { reason: 'maturity'|'early_exit', exit_date?: 'YYYY-MM-DD', period_end?: 'YYYY-MM-DD', preview_hash?: string }
 *  - exit_date only  → phase (i): stop the cohort, status matured
 *  - period_end+hash → phase (ii): final statement + principal_return + closed
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await adminWriter(req);
  if ("response" in g) return g.response;
  let b: { reason?: unknown; exit_date?: unknown; period_end?: unknown; preview_hash?: unknown };
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const reason = String(b.reason ?? "");
  if (!["maturity", "early_exit"].includes(reason)) return NextResponse.json({ error: "reason must be maturity or early_exit" }, { status: 400 });
  const exitDate = typeof b.exit_date === "string" && ISO_DATE.test(b.exit_date) ? b.exit_date : null;
  const periodEnd = typeof b.period_end === "string" && ISO_DATE.test(b.period_end) ? b.period_end : null;
  if (!exitDate && !periodEnd) return NextResponse.json({ error: "exit_date or period_end required" }, { status: 400 });

  let finalStatement: Record<string, unknown> | null = null;
  if (periodEnd) {
    // If an exit date is being set in the same call, the preview must be computed against it.
    if (exitDate) {
      const { error } = await g.admin.rpc("close_investor_deal", { p_deal_id: params.id, p_actor_id: g.actor.id, p_reason: reason, p_exit_date: exitDate, p_final_statement: null });
      if (error) return rpcError(error, "[POST deals/[id]/close phase i]");
    }
    const { drafts } = await previewSettlements(g.admin, [params.id], periodEnd, "final");
    const d = drafts[0];
    if (!d) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (d.error) return NextResponse.json({ error: d.error, code: d.error }, { status: 422 });
    if (d.preview_hash !== b.preview_hash) return NextResponse.json({ error: "PREVIEW_STALE", code: "PREVIEW_STALE" }, { status: 409 });
    const { warnings: _w, product_name: _p, image_url: _i, investor_name: _n, investor_id: _inv, currency: _c, error: _e, ...rest } = d;
    finalStatement = rest as unknown as Record<string, unknown>;
  }
  const { data, error } = await g.admin.rpc("close_investor_deal", {
    p_deal_id: params.id, p_actor_id: g.actor.id, p_reason: reason, p_exit_date: finalStatement && exitDate ? null : exitDate, p_final_statement: finalStatement,
  });
  if (error) return rpcError(error, "[POST deals/[id]/close]");
  await runInvestorRollup(g.admin, { trigger: "manual", mode: "incremental" });
  return NextResponse.json({ data });
}
