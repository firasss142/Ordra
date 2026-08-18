import { NextRequest, NextResponse } from "next/server";
import { adminReader, adminWriter, ISO_DATE, NO_STORE, rpcError, UUID_RE } from "@/lib/investors/admin-route";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { runInvestorRollup } from "@/lib/investors/rollup-run";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** All deals (manager: own market) with current terms, snapshot summary and settled totals. */
export async function GET(req: NextRequest) {
  const g = await adminReader(req);
  if ("response" in g) return g.response;
  const sp = req.nextUrl.searchParams;
  let q = g.admin
    .from("investor_deals")
    .select("id, investor_id, product_id, market_id, currency, label, start_date, end_date, status, close_reason, closed_at, note, created_at, products(name, image_url), investors(legal_name), investor_deal_snapshots(as_of, cumulative_share, unsettled_share, payable_now, carried_loss_after, counts, rates, in_flight, pending, excluded, totals)")
    .order("created_at", { ascending: false });
  if (g.actor.role === "market_manager") q = q.eq("market_id", g.actor.market_id ?? "");
  if (sp.get("investor_id")) q = q.eq("investor_id", sp.get("investor_id")!);
  if (sp.get("product_id")) q = q.eq("product_id", sp.get("product_id")!);
  if (sp.get("status")) q = q.eq("status", sp.get("status")!);
  const deals = await fetchAllRows<Record<string, unknown> & { id: string }>(q);
  const ids = deals.map((d) => d.id);
  const [terms, stmts] = ids.length
    ? await Promise.all([
        fetchAllRows<{ deal_id: string; effective_from: string; share_pct: string; capital_amount: string; payout_cadence: string; maturity_date: string }>(g.admin.from("investor_deal_terms").select("deal_id, effective_from, share_pct, capital_amount, payout_cadence, maturity_date").in("deal_id", ids).order("effective_from", { ascending: true })),
        fetchAllRows<{ deal_id: string; payable: string; period_end: string }>(g.admin.from("investor_deal_statements").select("deal_id, payable, period_end").in("deal_id", ids)),
      ])
    : [[], []];
  const data = deals.map((d) => {
    const t = terms.filter((x) => x.deal_id === d.id);
    const cur = t[t.length - 1] ?? null;
    const st = stmts.filter((x) => x.deal_id === d.id);
    return {
      ...d,
      terms_current: cur ? { effective_from: cur.effective_from, share_pct: Number(cur.share_pct), capital_amount: Number(cur.capital_amount), payout_cadence: cur.payout_cadence, maturity_date: cur.maturity_date, version: t.length } : null,
      settled_payable: st.reduce((a, s) => a + Number(s.payable), 0),
      statements_count: st.length,
      last_statement_end: st.map((s) => s.period_end).sort().pop() ?? null,
    };
  });
  return NextResponse.json({ data }, { headers: NO_STORE });
}

/**
 * Create a deal. Body: { investor_id, product_id, start_date, end_date | term_months,
 * share_pct, capital_amount, payout_cadence?, label?, note? }.
 * Kicks a full rollup for the product if it has no facts yet.
 */
export async function POST(req: NextRequest) {
  const g = await adminWriter(req);
  if ("response" in g) return g.response;
  let b: Record<string, unknown>;
  try {
    b = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const investorId = String(b.investor_id ?? "");
  const productId = String(b.product_id ?? "");
  const start = String(b.start_date ?? "");
  let end = typeof b.end_date === "string" ? b.end_date : "";
  const termMonths = Number(b.term_months);
  if (!UUID_RE.test(investorId) || !UUID_RE.test(productId)) return NextResponse.json({ error: "investor_id and product_id must be uuids" }, { status: 400 });
  if (!ISO_DATE.test(start)) return NextResponse.json({ error: "start_date must be YYYY-MM-DD" }, { status: 400 });
  if (!end && Number.isFinite(termMonths) && termMonths > 0) {
    const d = new Date(start + "T00:00:00Z");
    d.setUTCMonth(d.getUTCMonth() + termMonths);
    d.setUTCDate(d.getUTCDate() - 1);
    end = d.toISOString().slice(0, 10);
  }
  if (!ISO_DATE.test(end)) return NextResponse.json({ error: "end_date (or term_months) is required" }, { status: 400 });
  const share = Number(b.share_pct);
  const capital = Number(b.capital_amount ?? 0);
  if (!Number.isFinite(share) || share <= 0 || share > 100) return NextResponse.json({ error: "share_pct must be in (0, 100]" }, { status: 400 });
  if (!Number.isFinite(capital) || capital < 0) return NextResponse.json({ error: "capital_amount must be >= 0" }, { status: 400 });
  const cadence = String(b.payout_cadence ?? "quarterly");
  if (!["monthly", "quarterly", "semiannual", "annual", "at_maturity"].includes(cadence)) return NextResponse.json({ error: "invalid payout_cadence" }, { status: 400 });

  const { data, error } = await g.admin.rpc("create_investor_deal", {
    p: { investor_id: investorId, product_id: productId, start_date: start, end_date: end, share_pct: share, capital_amount: capital, payout_cadence: cadence, label: b.label ?? null, note: b.note ?? null },
    p_actor_id: g.actor.id,
  });
  if (error) return rpcError(error, "[POST /api/admin/investments/deals]");

  // First deal on this product → make the facts exist now rather than at the next cron.
  const { count } = await g.admin.from("investor_order_facts").select("order_id", { count: "exact", head: true }).eq("product_id", productId);
  let rollup: unknown = null;
  if (!count) rollup = await runInvestorRollup(g.admin, { trigger: "manual", mode: "full", productId });
  else rollup = await runInvestorRollup(g.admin, { trigger: "manual", mode: "incremental", productId });

  return NextResponse.json({ data: { id: data, rollup } }, { status: 201 });
}
