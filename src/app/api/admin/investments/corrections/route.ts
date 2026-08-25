import { NextRequest, NextResponse } from "next/server";
import { adminReader, adminWriter, NO_STORE, rpcError, UUID_RE } from "@/lib/investors/admin-route";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = await adminReader(req);
  if ("response" in g) return g.response;
  let q = g.admin.from("investor_ledger_entries").select("id, investor_id, deal_id, statement_id, market_id, currency, amount, note, created_by, created_at, investors(legal_name), investor_deals(label, products(name)), users:created_by(email)").eq("entry_type", "correction").order("created_at", { ascending: false }).limit(200);
  if (g.actor.role === "market_manager") q = q.eq("market_id", g.actor.market_id ?? "");
  const rows = await fetchAllRows(q);
  return NextResponse.json({ data: rows }, { headers: NO_STORE });
}

/** Body: { investor_id, amount (signed, non-zero), note (required), deal_id?, statement_id? } */
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
  const amount = Number(b.amount);
  const note = typeof b.note === "string" ? b.note.trim() : "";
  if (!UUID_RE.test(investorId)) return NextResponse.json({ error: "investor_id must be a uuid" }, { status: 400 });
  if (!Number.isFinite(amount) || amount === 0) return NextResponse.json({ error: "amount must be a non-zero number" }, { status: 400 });
  if (!note) return NextResponse.json({ error: "note is required" }, { status: 400 });
  const dealId = typeof b.deal_id === "string" && UUID_RE.test(b.deal_id) ? b.deal_id : null;
  const stmtId = typeof b.statement_id === "string" && UUID_RE.test(b.statement_id) ? b.statement_id : null;
  const { data, error } = await g.admin.rpc("post_investor_adjustment", { p_investor_id: investorId, p_amount: Math.round(amount * 1000) / 1000, p_note: note, p_actor_id: g.actor.id, p_deal_id: dealId, p_statement_id: stmtId });
  if (error) return rpcError(error, "[POST corrections]");
  return NextResponse.json({ data: { id: data } }, { status: 201 });
}
