import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

export const dynamic = "force-dynamic";

interface PreviewBody {
  market_id?: string;
  filter_json?: {
    order_statuses?: string[];
    date_from?: string;
    date_to?: string;
    product_id?: string;
    city?: string;
  };
}

interface PreviewHistoryRow {
  order_id: string;
  status_to: string;
  orders: { status: string } | { status: string }[] | null;
}

function embeddedOrder(
  value: PreviewHistoryRow["orders"],
): { status: string } | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export async function POST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (actor.role === "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: PreviewBody;
  try {
    body = (await req.json()) as PreviewBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { market_id, filter_json } = body;
  if (!market_id) {
    return NextResponse.json(
      { error: "market_id is required" },
      { status: 400 }
    );
  }
  if (
    filter_json === undefined ||
    filter_json === null ||
    typeof filter_json !== "object" ||
    Array.isArray(filter_json)
  ) {
    return NextResponse.json(
      { error: "filter_json must be an object" },
      { status: 400 }
    );
  }

  if (
    actor.role === "market_manager" &&
    market_id !== actor.market_id
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const orderStatuses =
    Array.isArray(filter_json.order_statuses) && filter_json.order_statuses.length > 0
      ? filter_json.order_statuses
      : ["delivered"];

  const supabase = await createClient();
  let query = supabase
    .from("order_history")
    .select("order_id, status_to, orders!inner(status)")
    .eq("orders.market_id", market_id)
    .in("status_to", orderStatuses)
    .in("orders.status", orderStatuses);

  if (filter_json.date_from) query = query.gte("created_at", filter_json.date_from);
  if (filter_json.date_to) query = query.lte("created_at", filter_json.date_to);
  if (filter_json.product_id) query = query.eq("orders.product_id", filter_json.product_id);
  if (filter_json.city) query = query.eq("orders.customer_city", filter_json.city);

  try {
    const rows = await fetchAllRows<PreviewHistoryRow>(query);
    const matchedOrderIds = new Set<string>();

    for (const row of rows) {
      const order = embeddedOrder(row.orders);
      if (order?.status === row.status_to) {
        matchedOrderIds.add(row.order_id);
      }
    }

    return NextResponse.json({ data: { matched: matchedOrderIds.size } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Preview failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
