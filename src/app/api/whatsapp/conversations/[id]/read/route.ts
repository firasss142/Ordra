import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { withRouteErrors } from "@/lib/journal/route-errors";

/**
 * POST /api/whatsapp/conversations/[id]/read — the agent opened the thread.
 * The RPC re-checks who may (super_admin, the market's manager, the agent
 * holding the order or lead) and clears the bell's row for it.
 */

export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest, { params }: { params: { id: string } }) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("whatsapp_mark_conversation_read", { p_conversation_id: params.id });
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "42501") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (code === "P0002") return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  return NextResponse.json({ data: { cleared: data ?? 0 } });
}

export const POST = withRouteErrors("/api/whatsapp/conversations/[id]/read", "POST", handlePOST);
