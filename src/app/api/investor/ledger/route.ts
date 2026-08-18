import { NextRequest, NextResponse } from "next/server";
import { investorActor, INVESTOR_CACHE } from "@/lib/investors/investor-route";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { foldLedgerByCurrency, type LedgerEntryLike } from "@/lib/investors/ledger-fold";

export const dynamic = "force-dynamic";

/** Every ledger movement (capital, settlement, withdrawal, correction, principal return) with the fold per currency. */
export async function GET(req: NextRequest) {
  const g = await investorActor(req);
  if ("response" in g) return g.response;
  try {
    const rows = await fetchAllRows<LedgerEntryLike & { id: string; deal_id: string | null; statement_id: string | null; withdrawal_id: string | null; note: string | null; created_at: string; investor_deals: { label: string | null; products: { name: string | null } | null } | null }>(
      g.admin
        .from("investor_ledger_entries")
        .select("id, entry_type, amount, currency, deal_id, statement_id, withdrawal_id, note, created_at, investor_deals(label, products(name))")
        .eq("investor_id", g.actor.id)
        .order("created_at", { ascending: false }),
    );
    const balances = Object.fromEntries(foldLedgerByCurrency(rows));
    return NextResponse.json({ data: rows, balances }, { headers: INVESTOR_CACHE });
  } catch (e) {
    console.error("[GET /api/investor/ledger]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
