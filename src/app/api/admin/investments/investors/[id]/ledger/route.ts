import { NextRequest, NextResponse } from "next/server";
import { adminReader, NO_STORE, todayFor } from "@/lib/investors/admin-route";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { foldLedgerByCurrency, type LedgerEntryLike } from "@/lib/investors/ledger-fold";
import { loadInvestorPortfolio } from "@/lib/investors/portfolio-summary";

export const dynamic = "force-dynamic";

/** What the investor sees (portfolio) + the full ledger with fold. Admin-side mirror of the portal. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await adminReader(req);
  if ("response" in g) return g.response;
  const { data: u } = await g.admin.from("users").select("id, market_id, role").eq("id", params.id).maybeSingle();
  const user = u as { id: string; market_id: string | null; role: string } | null;
  if (!user || user.role !== "investor") return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (g.actor.role === "market_manager" && user.market_id !== g.actor.market_id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const [portfolio, ledger, withdrawals] = await Promise.all([
    loadInvestorPortfolio(g.admin, params.id, todayFor(user.market_id)),
    fetchAllRows<LedgerEntryLike & { id: string }>(g.admin.from("investor_ledger_entries").select("id, entry_type, amount, currency, deal_id, statement_id, withdrawal_id, note, created_at, created_by, investor_deals(label, products(name)), users:created_by(email)").eq("investor_id", params.id).order("created_at", { ascending: false })),
    fetchAllRows(g.admin.from("investor_withdrawals").select("*").eq("investor_id", params.id).order("requested_at", { ascending: false })),
  ]);
  return NextResponse.json({ data: { portfolio, ledger, balances: Object.fromEntries(foldLedgerByCurrency(ledger)), withdrawals } }, { headers: NO_STORE });
}
