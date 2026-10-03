import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
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

  const rows = (data ?? []) as Array<Record<string, unknown> & { order_id: string; kind: string }>;

  // The bell's WhatsApp row quotes the customer: attach the latest inbound
  // message of each order with a whatsapp_inbound notification. RLS lets an
  // agent read only their own orders' messages. A failed read leaves the
  // excerpt empty rather than failing the bell.
  const waOrderIds = Array.from(new Set(rows.filter((n) => n.kind === "whatsapp_inbound").map((n) => n.order_id)));
  if (waOrderIds.length > 0) {
    const excerpts = new Map<string, string>();
    const { data: inbound, error: inboundError } = await supabase
      .from("whatsapp_messages")
      .select("order_id, body, created_at")
      .eq("direction", "in")
      .in("order_id", waOrderIds)
      .order("created_at", { ascending: false })
      .limit(200);
    if (!inboundError) {
      for (const m of (inbound ?? []) as Array<{ order_id: string | null; body: string | null }>) {
        if (m.order_id && m.body && !excerpts.has(m.order_id)) excerpts.set(m.order_id, m.body);
      }
    }
    for (const n of rows) {
      if (n.kind === "whatsapp_inbound") n.excerpt = excerpts.get(n.order_id) ?? null;
    }
  }

  return NextResponse.json({ data: rows });
}

export const GET = withRouteErrors("/api/notifications", "GET", handleGET);
