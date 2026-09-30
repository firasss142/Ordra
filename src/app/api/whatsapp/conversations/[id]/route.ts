import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { loadThread } from "@/lib/whatsapp/thread";

/**
 * GET /api/whatsapp/conversations/[id] — one thread by conversation id (the
 * inbox drawer). Visibility is the user client's: RLS lets a super_admin, the
 * market's manager, or the agent anchored on its order/lead through.
 */

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;

  const user = await createClient();
  const { data: conv, error } = await user.from("whatsapp_conversations").select("id, market_id, phone_e164, customer_id").eq("id", params.id).maybeSingle();
  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data = await loadThread(createAdminClient(), {
    marketId: conv.market_id as string,
    phones: [conv.phone_e164 as string],
    customerId: (conv.customer_id as string | null) ?? null,
  });
  return NextResponse.json({ data });
}
