import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canAssignOrders } from "@/lib/order-permissions";
import { getActor } from "@/lib/auth/actor";
import { fetchAgentCapacity } from "@/lib/orders/agent-capacity";

const USER_COLS = "id, full_name, avatar_url, is_active, last_seen_at";

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  const actorMarketId = actor.market_id ?? "";
  const marketId =
    actor.role === "super_admin"
      ? req.nextUrl.searchParams.get("market_id") ?? actorMarketId
      : actorMarketId;

  if (!canAssignOrders(actor.role, marketId, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!marketId) {
    return NextResponse.json({ error: "market_id required" }, { status: 400 });
  }

  const { data: agentRows, error: agentErr } = await supabase
    .from("users")
    .select(USER_COLS)
    .eq("role", "agent")
    .eq("market_id", marketId)
    .eq("is_active", true);

  if (agentErr) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const capacity = await fetchAgentCapacity(supabase, marketId);
  const capacityById = new Map(capacity.map((c) => [c.id, c]));

  // 7-day confirmation rate from get_agent_metrics RPC
  const toDate = new Date();
  const fromDate = new Date(toDate.getTime() - 7 * 24 * 60 * 60 * 1000);
  const { data: metricsRows } = await supabase.rpc("get_agent_metrics", {
    p_market_id: marketId,
    p_from_date: fromDate.toISOString().slice(0, 10),
    p_to_date: toDate.toISOString().slice(0, 10),
    p_agent_id: null,
  });

  const metricsById = new Map<string, { confirmation_rate: number; actioned_count: number }>();
  if (Array.isArray(metricsRows)) {
    for (const row of metricsRows) {
      const r = row as {
        agent_id?: string;
        confirmation_rate?: number;
        actioned_count?: number;
      };
      if (r.agent_id) {
        metricsById.set(r.agent_id, {
          confirmation_rate: r.confirmation_rate ?? 0,
          actioned_count: r.actioned_count ?? 0,
        });
      }
    }
  }

  const data = (agentRows ?? []).map(
    (a: {
      id: string;
      full_name: string | null;
      avatar_url: string | null;
      is_active: boolean;
      last_seen_at: string | null;
    }) => {
      const cap = capacityById.get(a.id);
      const met = metricsById.get(a.id);
      return {
        id: a.id,
        full_name: a.full_name,
        avatar_url: a.avatar_url,
        is_active: a.is_active,
        last_seen_at: a.last_seen_at,
        queue_size: cap?.queue_size ?? 0,
        last_action_at: cap?.last_action_at ?? null,
        confirmation_rate: met?.confirmation_rate ?? 0,
        actioned_count: met?.actioned_count ?? 0,
      };
    }
  );

  return NextResponse.json(
    { data },
    { headers: { "Cache-Control": "private, max-age=10, stale-while-revalidate=60" } }
  );
}
