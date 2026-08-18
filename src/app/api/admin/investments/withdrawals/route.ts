import { NextRequest, NextResponse } from "next/server";
import { adminReader, NO_STORE } from "@/lib/investors/admin-route";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

export const dynamic = "force-dynamic";

/** Queue. ?status=requested|approved|paid|rejected  (manager: own market) */
export async function GET(req: NextRequest) {
  const g = await adminReader(req);
  if ("response" in g) return g.response;
  const status = req.nextUrl.searchParams.get("status");
  let q = g.admin.from("investor_withdrawals").select("*, investors(legal_name)").order("requested_at", { ascending: false }).limit(300);
  if (g.actor.role === "market_manager") q = q.eq("market_id", g.actor.market_id ?? "");
  if (status) q = q.eq("status", status);
  const rows = await fetchAllRows<{ investor_id: string }>(q);
  // Balance context per investor so the decision panel can show the equation.
  const ids = [...new Set(rows.map((r) => r.investor_id))];
  const balances: Record<string, { available: number; open_claims: number }> = {};
  for (const id of ids) {
    const [a, c] = await Promise.all([g.admin.rpc("investor_available_balance", { p_investor_id: id }), g.admin.rpc("investor_open_withdrawal_claims", { p_investor_id: id })]);
    balances[id] = { available: Number(a.data ?? 0), open_claims: Number(c.data ?? 0) };
  }
  return NextResponse.json({ data: rows, balances }, { headers: NO_STORE });
}
