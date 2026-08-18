import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import type { OrderStatus } from "@/types/order-status";

export const dynamic = "force-dynamic";

const PHASE_2_STATUSES: OrderStatus[] = ["dispatched", "deposit", "in_transit", "to_be_returned"];
const TERMINAL_PHASE_2: OrderStatus[] = ["delivered", "returned"];

export interface TimelineStage {
  status: OrderStatus;
  at: string;
  duration_hours: number | null;
}

export interface TimelineHistoryEntry {
  id: string;
  status_from: OrderStatus | null;
  status_to: OrderStatus;
  actor_type: "system" | "agent" | "manager";
  note: string | null;
  created_at: string;
}

export interface OrderTimeline {
  order: {
    id: string;
    external_id: string | null;
    status: OrderStatus;
    carrier_name: string;
    /** Gates carrier-specific detail panels (e.g. Darb Assabil). */
    carrier_code: string | null;
    created_at: string;
    updated_at: string;
    needs_carrier_followup: boolean;
  };
  stages: TimelineStage[];
  history: TimelineHistoryEntry[];
}

function isRelevantStage(s: string): s is OrderStatus {
  return (
    (PHASE_2_STATUSES as string[]).includes(s) || (TERMINAL_PHASE_2 as string[]).includes(s)
  );
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  // Agents read this too, scoped to their own orders (checked below). The route
  // was manager-only, which meant the order panel's tracking tab rendered empty
  // for the people who spend all day in it.
  if (
    actor.role !== "super_admin" &&
    actor.role !== "market_manager" &&
    actor.role !== "agent"
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: orderRow, error: orderErr } = await supabase
    .from("orders")
    .select(
      "id, external_id, status, market_id, carrier_id, assigned_to, created_at, updated_at, needs_carrier_followup, carriers!orders_carrier_id_fkey(name, code)",
    )
    .eq("id", params.id)
    .single();

  if (orderErr || !orderRow) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  type OrderRow = {
    id: string;
    external_id: string | null;
    status: OrderStatus;
    market_id: string;
    carrier_id: string | null;
    assigned_to: string | null;
    created_at: string;
    updated_at: string;
    needs_carrier_followup: boolean | null;
    carriers:
      | { name: string; code: string }
      | { name: string; code: string }[]
      | null;
  };
  const order = orderRow as OrderRow;

  if (actor.role === "market_manager" && order.market_id !== actor.market_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // An agent sees the tracking of orders they own and nothing else. 404 rather
  // than 403 — the same shape the rest of the agent routes use, so a probe
  // cannot distinguish "not yours" from "does not exist".
  if (actor.role === "agent" && order.assigned_to !== actor.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: historyRows, error: historyErr } = await supabase
    .from("order_history")
    .select("id, status_from, status_to, actor_type, note, created_at")
    .eq("order_id", params.id)
    .order("created_at", { ascending: true });

  if (historyErr) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  type HistoryRow = {
    id: string;
    status_from: OrderStatus | null;
    status_to: OrderStatus;
    actor_type: "system" | "agent" | "manager";
    note: string | null;
    created_at: string;
  };
  const history = (historyRows ?? []) as HistoryRow[];

  const stageEntries = history.filter((h) => isRelevantStage(h.status_to));
  const stages: TimelineStage[] = stageEntries.map((entry, idx) => {
    const next = stageEntries[idx + 1];
    let duration: number | null = null;
    if (next) {
      const startMs = new Date(entry.created_at).getTime();
      const endMs = new Date(next.created_at).getTime();
      duration = Math.round((endMs - startMs) / (60 * 60 * 1000));
    } else if (!(TERMINAL_PHASE_2 as string[]).includes(entry.status_to)) {
      const startMs = new Date(entry.created_at).getTime();
      duration = Math.round((Date.now() - startMs) / (60 * 60 * 1000));
    }
    return { status: entry.status_to, at: entry.created_at, duration_hours: duration };
  });

  const carrierRel = Array.isArray(order.carriers) ? order.carriers[0] : order.carriers;

  const body: OrderTimeline = {
    order: {
      id: order.id,
      external_id: order.external_id,
      status: order.status,
      carrier_name: carrierRel?.name ?? "",
      carrier_code: carrierRel?.code ?? null,
      created_at: order.created_at,
      updated_at: order.updated_at,
      needs_carrier_followup: Boolean(order.needs_carrier_followup),
    },
    stages,
    history: history.map((h) => ({
      id: h.id,
      status_from: h.status_from,
      status_to: h.status_to,
      actor_type: h.actor_type,
      note: h.note,
      created_at: h.created_at,
    })),
  };

  return NextResponse.json(body);
}
