import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";

/** GET /api/whatsapp/conversations/unread-count?market_id= — the sidebar badge. */

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (actor.role !== "super_admin" && actor.role !== "market_manager") return NextResponse.json({ count: 0 });
  const marketId = new URL(req.url).searchParams.get("market_id");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("whatsapp_orphan_unread_count", { p_market: marketId || null });
  if (error) return NextResponse.json({ count: 0 });
  return NextResponse.json({ count: Number(data ?? 0) });
}
