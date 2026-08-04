import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewOwnPortfolio } from "@/lib/investor-permissions";

export const dynamic = "force-dynamic";

/** Enough to explain a balance without turning into an audit log. */
const MAX_ENTRIES = 200;

/**
 * Every movement in the investor's own ledger, newest first.
 *
 * The portal could show four balance buckets and no reason any of them had the
 * value it did. A correction, a reserve release or a paid withdrawal simply
 * changed a number overnight, which reads as money appearing or vanishing. The
 * ledger is append-only and already the source of truth for the balance, so
 * replaying it is not a second system to keep in sync — it is the same fold the
 * balance is computed from, shown line by line.
 *
 * The investor id comes from the session via getActor() and is NEVER read from
 * a query parameter or body — that is the single control preventing one
 * investor from reading another's ledger, since the service-role client used
 * here bypasses RLS.
 */
export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canViewOwnPortfolio(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("investor_ledger")
    .select(
      `id, entry_type, amount, note, created_at, product_id, statement_id,
       products(name),
       investor_statements(period_start, period_end)`
    )
    .eq("investor_id", actor.id)
    .order("created_at", { ascending: false })
    .limit(MAX_ENTRIES);

  if (error) {
    console.error("[GET /api/investor/ledger]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const rows = (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    const productRel = r.products as { name: string } | { name: string }[] | undefined;
    const product = Array.isArray(productRel) ? productRel[0] : productRel;
    const stmtRel = r.investor_statements as
      | { period_start: string; period_end: string }
      | { period_start: string; period_end: string }[]
      | undefined;
    const statement = Array.isArray(stmtRel) ? stmtRel[0] : stmtRel;

    return {
      id: r.id,
      entry_type: r.entry_type,
      amount: r.amount,
      // created_by is deliberately absent: which staff member posted a
      // correction is internal, and naming them invites the investor to argue
      // with a person rather than with the figure.
      note: r.note ?? null,
      created_at: r.created_at,
      product_id: r.product_id ?? null,
      product_name: product?.name ?? null,
      statement_id: r.statement_id ?? null,
      period_start: statement?.period_start ?? null,
      period_end: statement?.period_end ?? null,
    };
  });

  return NextResponse.json({ data: rows });
}
