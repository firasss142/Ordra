import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { resolveMarketForManage } from "@/lib/whatsapp/authz";
import { withRouteErrors } from "@/lib/journal/route-errors";

/**
 * GET /api/whatsapp/conversations?market_id=&scope=orphans|all — the inbox
 * list for managers and super_admin. `orphans` (default) = conversations no
 * order or prospect claims; `all` = every conversation of the market, newest
 * first. Agents never come here: their threads live on their orders.
 */

export const dynamic = "force-dynamic";

const CONVERSATION_LIST_COLUMNS =
  "id, market_id, phone_e164, customer_id, current_order_id, current_lead_id, profile_name, last_inbound_at, last_outbound_at, last_message_at, last_message_preview, unread_count, opted_out_at, undeliverable_at, claimed_by, claimed_at, created_at";

async function handleGET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const url = new URL(req.url);
  const access = resolveMarketForManage(actorResult.actor, url.searchParams.get("market_id"));
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });
  const scope = url.searchParams.get("scope") === "all" ? "all" : "orphans";
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 100) || 100));

  const admin = createAdminClient();
  let query = admin.from("whatsapp_conversations").select(CONVERSATION_LIST_COLUMNS).eq("market_id", access.marketId);
  if (scope === "orphans") query = query.is("current_order_id", null).is("current_lead_id", null);

  // Both tab counts, whichever tab is open (« À rattacher 3 · Toutes 27 »).
  // Each count is exactly what its tab lists; head-only, no rows travel.
  const orphansCount = admin
    .from("whatsapp_conversations")
    .select("id", { count: "exact", head: true })
    .eq("market_id", access.marketId)
    .is("current_order_id", null)
    .is("current_lead_id", null)
    .not("last_message_at", "is", null);
  const allCount = admin.from("whatsapp_conversations").select("id", { count: "exact", head: true }).eq("market_id", access.marketId);

  const [{ data, error }, orphansRes, allRes] = await Promise.all([
    query.order("last_message_at", { ascending: false }).limit(limit),
    orphansCount,
    allCount,
  ]);
  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  const rows = ((data ?? []) as { last_message_at: string | null }[]).filter((r) => scope === "all" || r.last_message_at);
  return NextResponse.json({
    data: rows,
    scope,
    counts: { orphans: orphansRes.count ?? 0, all: allRes.count ?? 0 },
  });
}

export const GET = withRouteErrors("/api/whatsapp/conversations", "GET", handleGET);
