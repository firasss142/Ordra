import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  // Signed-cookie fast path instead of auth.getUser() — the bell polls this on
  // every agent page, so a network round-trip to Supabase Auth per poll is pure
  // latency. RLS still scopes rows to auth.uid(); this only resolves identity.
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;

  const includeAll = req.nextUrl.searchParams.get("include") === "all";

  // RLS ensures agent_id = auth.uid() — no extra filter needed.
  // Embed minimal order context so the bell row can show "<customer> · <product>"
  // without an extra round-trip per notification.
  let query = supabase
    .from("agent_notifications")
    .select(`
      id,
      order_id,
      kind,
      due_at,
      read_at,
      created_at,
      order:orders!agent_notifications_order_id_fkey(
        customer_name,
        product_name,
        variant_label
      )
    `)
    .order("created_at", { ascending: false })
    .limit(50);

  if (!includeAll) {
    query = query.is("read_at", null);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? [] });
}
