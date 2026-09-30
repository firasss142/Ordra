import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canAssignOrders } from "@/lib/order-permissions";
import { getActor } from "@/lib/auth/actor";
import { fetchAgentCapacity } from "@/lib/orders/agent-capacity";
import { isReadyForOrders } from "@/lib/orders/agent-readiness";

export const dynamic = "force-dynamic";

const USER_COLS =
  "id, full_name, avatar_url, is_active, last_seen_at, market_id, is_available, available_since";

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

  // super_admin with no market_id sees agents across all markets.
  const isAllMarkets = actor.role === "super_admin" && !marketId;

  if (!marketId && !isAllMarkets) {
    return NextResponse.json({ error: "market_id required" }, { status: 400 });
  }

  let agentQuery = supabase
    .from("users")
    .select(USER_COLS)
    .eq("role", "agent")
    .eq("is_active", true);
  if (!isAllMarkets) {
    agentQuery = agentQuery.eq("market_id", marketId);
  }
  const { data: agentRows, error: agentErr } = await agentQuery;

  if (agentErr) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const capacity = await fetchAgentCapacity(supabase, isAllMarkets ? null : marketId);
  const capacityById = new Map(capacity.map((c) => [c.id, c]));

  // 7-day confirmation rate from get_agent_metrics RPC.
  // For super_admin "all", fan out per market and merge.
  const toDate = new Date();
  const fromDate = new Date(toDate.getTime() - 7 * 24 * 60 * 60 * 1000);
  const metricsById = new Map<string, { confirmation_rate: number; actioned_count: number }>();

  const marketIdsForMetrics = isAllMarkets
    ? Array.from(
        new Set(
          ((agentRows ?? []) as Array<{ market_id?: string | null }>)
            .map((a) => a.market_id ?? null)
            .filter((m): m is string => Boolean(m))
        )
      )
    : [marketId];

  await Promise.all(
    marketIdsForMetrics.map(async (mid) => {
      const { data: metricsRows } = await supabase.rpc("get_agent_metrics", {
        p_market_id: mid,
        p_from_date: fromDate.toISOString().slice(0, 10),
        p_to_date: toDate.toISOString().slice(0, 10),
        p_agent_id: null,
      });
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
    })
  );

  // The configured split, so the rail can show progress against target rather
  // than a bare count. Absent when the market does not use percentages.
  const sharesById = new Map<string, number>();
  if (!isAllMarkets && marketId) {
    const { data: shareRows } = await supabase
      .from("agent_distribution_shares")
      .select("agent_id, share_pct")
      .eq("market_id", marketId);
    for (const row of (shareRows ?? []) as Array<{
      agent_id: string;
      share_pct: number | string;
    }>) {
      const pct = typeof row.share_pct === "string" ? Number(row.share_pct) : row.share_pct;
      if (Number.isFinite(pct)) sharesById.set(row.agent_id, pct);
    }
  }

  const now = new Date();

  const data = (agentRows ?? []).map(
    (a: {
      id: string;
      full_name: string | null;
      avatar_url: string | null;
      is_active: boolean;
      last_seen_at: string | null;
      is_available: boolean | null;
      available_since: string | null;
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
        is_available: a.is_available ?? false,
        available_since: a.available_since,
        assigned_today: cap?.assigned_today ?? 0,
        share_pct: sharesById.get(a.id) ?? null,
        // The declaration and the heartbeat together — what the distributor
        // checks. Shown separately from `is_available` so a manager can tell
        // "took a break" apart from "laptop is shut".
        receiving_orders: cap ? isReadyForOrders(cap, now) : false,
      };
    }
  );

  return NextResponse.json(
    { data },
    { headers: { "Cache-Control": "private, max-age=10, stale-while-revalidate=60" } }
  );
}
