import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewInvestorAdmin } from "@/lib/investor-permissions";
import { foldLedger, type LedgerEntryType } from "@/lib/calculations/investor-balance";

export const dynamic = "force-dynamic";

const MAX_ENTRIES = 200;

/**
 * One investor's ledger and folded balance, for the operator.
 *
 * The admin surface could create positions, close periods, approve withdrawals
 * and post corrections — and nowhere show what any investor was actually owed.
 * The person authorising a payout had strictly less information about it than
 * the person receiving it. This closes that.
 *
 * The balance is folded with the same `foldLedger` the investor's own portfolio
 * uses, so the two gates cannot disagree about a number by drifting apart.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canViewInvestorAdmin(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  // A market_manager may only look at investors in their own market.
  const { data: investorUser } = await admin
    .from("users")
    .select("market_id")
    .eq("id", id)
    .single();

  if (!investorUser) {
    return NextResponse.json({ error: "Investor not found" }, { status: 404 });
  }
  if (actor.role === "market_manager" && investorUser.market_id !== actor.market_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await admin
    .from("investor_ledger")
    .select(
      `id, entry_type, amount, note, created_at, product_id, statement_id,
       products(name)`
    )
    .eq("investor_id", id)
    .order("created_at", { ascending: false })
    .limit(MAX_ENTRIES);

  if (error) {
    console.error("[GET /api/admin/investments/investors/[id]/ledger]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const entries = (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    const rel = r.products as { name: string } | { name: string }[] | undefined;
    const product = Array.isArray(rel) ? rel[0] : rel;
    return {
      id: r.id as string,
      entry_type: r.entry_type as LedgerEntryType,
      amount: Number(r.amount),
      note: (r.note as string | null) ?? null,
      created_at: r.created_at as string,
      product_name: product?.name ?? null,
    };
  });

  // The fold needs every entry, not the newest 200 — a truncated ledger folds
  // to a wrong balance, which is worse than no balance at all.
  const { data: allEntries, error: foldError } = await admin
    .from("investor_ledger")
    .select("entry_type, amount")
    .eq("investor_id", id);

  if (foldError) {
    console.error("[GET /api/admin/investments/investors/[id]/ledger] fold", foldError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const balance = foldLedger(
    (allEntries ?? []).map((e) => ({
      entryType: (e as Record<string, unknown>).entry_type as LedgerEntryType,
      amount: Number((e as Record<string, unknown>).amount),
    }))
  );

  return NextResponse.json({
    data: {
      balance,
      entries,
      truncated: entries.length === MAX_ENTRIES,
    },
  });
}
