import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

/**
 * Every live presence row the caller may see — who has which order open.
 *
 * A separate, tiny SWR key rather than a join into /api/orders/list, and not
 * only for cost. useOrdersList sets revalidateFirstPage:false and
 * refreshInterval:0 while realtime is connected, and taking a lock changes no
 * order row, so no order_changed broadcast fires. A lock joined into the list
 * would go stale and stay stale.
 *
 * The response is at most "panels currently open" — tens of rows — and one
 * fetch serves every page, every filter and the drawer.
 */
export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  // Agents are served too, and that is the whole agent half of the feature: an
  // agent must be able to see that a manager is standing on THEIR order. What
  // comes back is scoped by the order_presence SELECT policy, not by this gate
  // — super_admin sees all, market_manager their market, an agent only their
  // own rows plus rows on orders assigned to them. Gating by role here left
  // that RLS arm dead and the agent's screen blank.
  //
  // warehouse_agent is still refused: they never open an order detail view.
  if (
    actor.role !== "super_admin" &&
    actor.role !== "market_manager" &&
    actor.role !== "agent"
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();

  // Via RPC, not a table select. The name and photo have to ride along — a head
  // icon without a name is useless — and no client-side directory can supply
  // them: /api/agents is `role='agent'` only, and /api/users hands a
  // market_manager nothing but agents, so a MANAGER could never be named.
  //
  // Embedding `users(...)` in a plain select does not work either: `users` RLS
  // stops an agent reading a manager's row, so the join silently yields NULL
  // and the head renders as the dashed "+" that means "unassigned" everywhere
  // else in the product. Verified against production before this was changed.
  //
  // list_order_presence is SECURITY DEFINER and restates the order_presence
  // SELECT policy verbatim: it crosses the `users` boundary without widening
  // who may see which rows.
  const { data, error } = await supabase.rpc("list_order_presence");

  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json(
    {
      data: data ?? [],
      // So the client can correct for clock skew instead of trusting a laptop
      // clock to decide whether a lock has expired.
      server_now: new Date().toISOString(),
    },
    // Never cached: a two-second edge cache would make the indicator lie for
    // longer than a heartbeat.
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
