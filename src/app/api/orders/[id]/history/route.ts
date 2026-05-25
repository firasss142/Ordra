import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewOrders } from "@/lib/order-permissions";

export const dynamic = "force-dynamic";

export interface OrderHistoryEntry {
  id: string;
  from_status: string | null;
  to_status: string;
  actor_type: "system" | "agent" | "manager";
  actor_name: string | null;
  actor_avatar_url: string | null;
  created_at: string;
}

/**
 * The popover is intentionally a JOURNEY view — status transitions and
 * assignment events only. Field edits, mapping warnings, escalations, barcode
 * operations, reassignments and dispatch-cancel toggles are still stored in
 * `order_history` and visible in the order detail panel + audit log; they are
 * filtered out here to keep the hover read scannable.
 *
 * Initial-assignment notes are written by Postgres functions in French/English
 * variants; auto-assignment is suffixed with the algorithm name.
 */
const ASSIGNMENT_NOTE = /^(Assigned to agent|Auto-assigned|Assigné à l'agent)/i;

function isJourneyEntry(h: {
  status_from: string | null;
  status_to: string;
  note: string | null;
}): boolean {
  if (h.status_from !== h.status_to) return true; // real status change
  if (h.note && ASSIGNMENT_NOTE.test(h.note)) return true; // initial assignment
  return false;
}

/**
 * Lightweight, on-demand status-history feed for the orders-table hover popover.
 * Returns the order's status timeline (newest first) with each actor's UUID
 * resolved to a display name + avatar in a single users lookup. The full
 * single-order endpoint (../route.ts) intentionally omits this join to keep its
 * payload lean; this route exists so the popover can fetch only when hovered.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  const { data: order, error } = await supabase
    .from("orders")
    .select("id, status, market_id, assigned_to, customer_name, external_platform")
    .eq("id", id)
    .single();

  if (error || !order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (!canViewOrders(role, order.market_id, actor.market_id ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Agents may only see history for orders assigned to them.
  if (role === "agent" && order.assigned_to !== actor.id) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const { data: historyRows } = await supabase
    .from("order_history")
    .select("id, status_from, status_to, note, actor_id, actor_type, created_at")
    .eq("order_id", id)
    .order("created_at", { ascending: true }); // oldest first — chronological journey

  // Sort defensively as well so the chronological order holds regardless of
  // the driver, THEN drop the rows that aren't part of the status / assignment
  // journey (mapping warnings, field edits, barcode ops, escalations…).
  const rows = [...(historyRows ?? [])]
    .filter(isJourneyEntry)
    .sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );

  // Resolve every distinct non-null actor in a single round-trip.
  const actorIds = [
    ...new Set(rows.map((h) => h.actor_id).filter((v): v is string => Boolean(v))),
  ];
  const actorMap = new Map<string, { full_name: string | null; avatar_url: string | null }>();
  if (actorIds.length > 0) {
    const { data: users } = await supabase
      .from("users")
      .select("id, full_name, avatar_url")
      .in("id", actorIds);
    for (const u of users ?? []) {
      actorMap.set(u.id, { full_name: u.full_name, avatar_url: u.avatar_url });
    }
  }

  const entries: OrderHistoryEntry[] = rows.map((h) => {
    const resolved = h.actor_id ? actorMap.get(h.actor_id) : undefined;
    return {
      id: h.id,
      from_status: h.status_from,
      to_status: h.status_to,
      actor_type: h.actor_type,
      actor_name: resolved?.full_name ?? null,
      actor_avatar_url: resolved?.avatar_url ?? null,
      created_at: h.created_at,
    };
  });

  return NextResponse.json({
    data: {
      customer_name: order.customer_name ?? null,
      source_platform: order.external_platform ?? null,
      entries,
    },
  });
}
