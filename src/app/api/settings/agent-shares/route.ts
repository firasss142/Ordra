import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canWriteSettings } from "@/lib/settings-permissions";
import type { Role } from "@/types";
import { validateShares } from "@/lib/orders/agent-shares";

export const dynamic = "force-dynamic";

/**
 * The per-agent percentage split.
 *
 * Its own endpoint rather than a field on the monolithic `MarketSettings`
 * PATCH, for the same reason the rejection taxonomy has one: it owns rows in a
 * table keyed by agent, and folding a variable-length map into a validator
 * that rejects the whole settings object on one bad key would take every
 * unrelated setting on the page down with it.
 *
 * GET returns a row for every active agent, including those with no stored
 * share, so the editor can show the gap the manager has to close.
 */

function resolveMarket(
  actor: { role: string; market_id: string | null },
  queryMarketId: string | null,
): { marketId: string } | { error: NextResponse } {
  if (actor.role === "super_admin") {
    if (!queryMarketId) {
      return {
        error: NextResponse.json(
          { error: "market_id is required for super_admin" },
          { status: 400 },
        ),
      };
    }
    return { marketId: queryMarketId };
  }
  if (!actor.market_id) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  if (queryMarketId && queryMarketId !== actor.market_id) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { marketId: actor.market_id };
}

interface AgentRow {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
}

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  const url = new URL(req.url);
  const resolved = resolveMarket(actor, url.searchParams.get("market_id"));
  if ("error" in resolved) return resolved.error;

  const supabase = await createClient();

  const [{ data: agentRows, error: agentErr }, { data: shareRows, error: shareErr }] =
    await Promise.all([
      supabase
        .from("users")
        .select("id, full_name, avatar_url")
        .eq("role", "agent")
        .eq("market_id", resolved.marketId)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("full_name"),
      supabase
        .from("agent_distribution_shares")
        .select("agent_id, share_pct")
        .eq("market_id", resolved.marketId),
    ]);

  if (agentErr || shareErr) {
    console.error("[GET /api/settings/agent-shares] read failed", {
      agent: agentErr?.message,
      share: shareErr?.message,
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const stored = new Map(
    ((shareRows ?? []) as Array<{ agent_id: string; share_pct: number | string }>).map((r) => [
      r.agent_id,
      typeof r.share_pct === "string" ? Number(r.share_pct) : r.share_pct,
    ]),
  );

  // A soft-deleted agent's row survives in the table; it is not returned here
  // and the PUT below refuses it, so it cannot keep claiming a percentage.
  const data = ((agentRows ?? []) as AgentRow[]).map((a) => ({
    agent_id: a.id,
    full_name: a.full_name,
    avatar_url: a.avatar_url,
    share_pct: stored.get(a.id) ?? null,
  }));

  return NextResponse.json({ data });
}

interface PutBody {
  market_id?: unknown;
  shares?: unknown;
}

export async function PUT(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  let body: PutBody;
  try {
    body = (await req.json()) as PutBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const resolved = resolveMarket(
    actor,
    typeof body.market_id === "string" ? body.market_id : null,
  );
  if ("error" in resolved) return resolved.error;

  if (!canWriteSettings(actor.role as Role, resolved.marketId, actor.market_id ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (body.shares === null || typeof body.shares !== "object" || Array.isArray(body.shares)) {
    return NextResponse.json({ error: "shares must be an object" }, { status: 400 });
  }
  const shares = body.shares as Record<string, number>;

  const supabase = await createClient();

  const { data: agentRows, error: agentErr } = await supabase
    .from("users")
    .select("id")
    .eq("role", "agent")
    .eq("market_id", resolved.marketId)
    .eq("is_active", true)
    .is("deleted_at", null);

  if (agentErr) {
    console.error("[PUT /api/settings/agent-shares] agent read failed", {
      code: agentErr.code,
      message: agentErr.message,
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const activeIds = ((agentRows ?? []) as Array<{ id: string }>).map((a) => a.id);

  // Validate EVERYTHING before writing anything: a half-applied split would
  // silently under- or over-cover the day until someone noticed.
  const validation = validateShares(shares, activeIds);
  if (!validation.valid) {
    return NextResponse.json(
      { error: "Répartition invalide", details: validation.errors },
      { status: 400 },
    );
  }

  const rows = activeIds.map((agentId) => ({
    market_id: resolved.marketId,
    agent_id: agentId,
    share_pct: shares[agentId],
    updated_by: actor.id,
  }));

  if (rows.length > 0) {
    const { error: upsertErr } = await supabase
      .from("agent_distribution_shares")
      .upsert(rows, { onConflict: "market_id,agent_id" });

    if (upsertErr) {
      console.error("[PUT /api/settings/agent-shares] upsert failed", {
        code: upsertErr.code,
        message: upsertErr.message,
      });
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  }

  // Rows for agents who have since left stay behind otherwise, still claiming
  // a percentage of every day.
  if (activeIds.length > 0) {
    await supabase
      .from("agent_distribution_shares")
      .delete()
      .eq("market_id", resolved.marketId)
      .not("agent_id", "in", `(${activeIds.join(",")})`);
  }

  return NextResponse.json({ data: { updated: rows.length } });
}
