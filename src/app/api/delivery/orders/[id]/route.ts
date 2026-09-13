import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canUseDeliveryWorklist } from "@/lib/role-permissions";
import { UUID_RE } from "@/lib/investors/admin-route";
import {
  mergeTimeline,
  type ActionRow,
  type CarrierEventRow,
  type ConversationRow,
  type HistoryRow,
} from "@/lib/delivery/timeline";

export const dynamic = "force-dynamic";

const LIMIT = 200;

/**
 * GET /api/delivery/orders/[id]?lang=ar|fr — the merged parcel timeline.
 *
 * Order of reads matters. darb_timeline_events and darb_conversation are
 * readable by every signed-in user, so the order is fetched FIRST under the
 * caller's RLS; only a visible order unlocks the carrier tables.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (!canUseDeliveryWorklist(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ error: "invalid_order_id" }, { status: 400 });
  }
  const lang = req.nextUrl.searchParams.get("lang") === "ar" ? "ar" : "fr";

  const supabase = await createClient();
  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id")
    .eq("id", params.id)
    .maybeSingle();
  if (orderError) {
    console.error("[api/delivery/orders] order read failed", orderError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const [history, events, conversation, actions] = await Promise.all([
    supabase
      .from("order_history")
      .select("id, status_from, status_to, note, created_at")
      .eq("order_id", params.id)
      .order("created_at", { ascending: false })
      .limit(LIMIT),
    supabase
      .from("darb_timeline_events")
      .select("id, type, description_ar, description_en, remarks, actor_name, occurred_at")
      .eq("order_id", params.id)
      .order("occurred_at", { ascending: false })
      .limit(LIMIT),
    supabase
      .from("darb_conversation")
      .select("id, message, author_name, posted_at")
      .eq("order_id", params.id)
      .order("posted_at", { ascending: false })
      .limit(LIMIT),
    supabase
      .from("delivery_actions")
      .select("id, action_type, outcome, note, actor_id, actor_type, created_at, actor:users(full_name)")
      .eq("order_id", params.id)
      .order("created_at", { ascending: false })
      .limit(LIMIT),
  ]);

  for (const r of [history, events, conversation, actions]) {
    if (r.error) {
      console.error("[api/delivery/orders] timeline read failed", r.error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  }

  // The generated types model the users embed as an array; PostgREST returns
  // one object for a to-one foreign key. Accept both.
  type Embedded = { full_name: string | null } | { full_name: string | null }[] | null;
  const actionRows: ActionRow[] = (
    (actions.data ?? []) as unknown as (Omit<ActionRow, "actor_name"> & { actor: Embedded })[]
  ).map(({ actor: a, ...rest }) => ({ ...rest, actor_name: (Array.isArray(a) ? a[0]?.full_name : a?.full_name) ?? null }));

  const timeline = mergeTimeline({
    history: (history.data ?? []) as HistoryRow[],
    events: (events.data ?? []) as CarrierEventRow[],
    conversation: (conversation.data ?? []) as ConversationRow[],
    actions: actionRows,
    viewerId: actor.id,
    lang,
  });

  return NextResponse.json({ data: { timeline } });
}
