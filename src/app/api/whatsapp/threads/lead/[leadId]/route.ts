import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { loadThread } from "@/lib/whatsapp/thread";
import { withRouteErrors } from "@/lib/journal/route-errors";

/** GET /api/whatsapp/threads/lead/[leadId] — the thread behind a prospect. */

export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest, { params }: { params: { leadId: string } }) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (actor.role !== "agent" && actor.role !== "market_manager" && actor.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const user = await createClient();
  const { data: lead, error } = await user.from("leads").select("id, market_id, assigned_to, customer_phone").eq("id", params.leadId).maybeSingle();
  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (actor.role === "agent" && lead.assigned_to !== actor.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const data = await loadThread(createAdminClient(), { marketId: lead.market_id as string, phones: [lead.customer_phone as string | null] });
  return NextResponse.json({ data });
}

export const GET = withRouteErrors("/api/whatsapp/threads/lead/[leadId]", "GET", handleGET);
