import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewOrders } from "@/lib/order-permissions";
import { ARCHIVE_STATUSES } from "@/lib/orders/archive-scope";

export const dynamic = "force-dynamic";

/**
 * The archive summary — one snapshot, computed in the database.
 *
 * This used to fetch up to 20 000 order rows and aggregate them in Node, which
 * had two visible consequences: counts silently truncated past the cap, and
 * `total` was taken over a different set than the outcome tiles, so the
 * percentages could not sum to 100%. `get_archive_summary` computes every
 * figure from one CTE, so total = sum(outcomes) by construction.
 *
 * The window is measured on `terminal_at` — when the order finished — not
 * `created_at`, which is what made the weekly cohorts wrong.
 */
export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const actorMarketId = actor.market_id ?? "";

  if (actor.role !== "super_admin" && actor.role !== "market_manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = req.nextUrl.searchParams;
  const fromDate = params.get("from_date");
  const toDate = params.get("to_date");
  if (!fromDate || !toDate) {
    return NextResponse.json({ error: "from_date and to_date are required" }, { status: 400 });
  }

  const marketId = actor.role === "super_admin" ? params.get("market_id") : actorMarketId;
  if (!marketId) {
    return NextResponse.json({ error: "market_id is required" }, { status: 400 });
  }
  if (!canViewOrders(actor.role, marketId, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Narrow to the requested outcomes, intersected with the archive so an
  // unrecognised status cannot pull live orders in. Null means "all of them" —
  // the RPC skips the filter entirely rather than matching an empty list.
  const statusParam = params.get("status");
  const statuses = statusParam
    ? statusParam
        .split(",")
        .map((s) => s.trim())
        .filter((s) => (ARCHIVE_STATUSES as readonly string[]).includes(s))
    : [];

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_archive_summary", {
    p_market_id: marketId,
    p_from_date: fromDate,
    p_to_date: toDate,
    p_statuses: statuses.length > 0 ? statuses : null,
    p_q: params.get("q") || null,
    p_rejection_reason: params.get("rejection_reason") || null,
  });

  if (error) {
    // The RPC enforces market isolation itself; surface that as a 403 rather
    // than a generic failure.
    if (error.code === "42501") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data });
}
