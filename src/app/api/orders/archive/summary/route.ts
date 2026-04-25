import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewOrders } from "@/lib/order-permissions";
import { TERMINAL_STATUSES, REJECTION_REASONS, type OrderStatus, type RejectionReason } from "@/types/order-status";

const MAX_ROWS = 20_000;

type TerminalRow = {
  status: OrderStatus;
  rejection_reason: RejectionReason | null;
  product_id: string | null;
  product_name: string | null;
  customer_city: string | null;
  carrier_id: string | null;
  created_at: string;
};

// ISO 8601 week key (e.g. "2026-W17") — Thursday-anchor rule
function isoWeekKey(iso: string): string {
  const d = new Date(iso);
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const year = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function topN<T extends { count: number }>(map: Map<string, T>, n: number): T[] {
  return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, n);
}

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (actor.role !== "super_admin" && actor.role !== "market_manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const fromDate = req.nextUrl.searchParams.get("from_date");
  const toDate = req.nextUrl.searchParams.get("to_date");
  if (!fromDate || !toDate) {
    return NextResponse.json(
      { error: "from_date and to_date query parameters are required" },
      { status: 400 },
    );
  }

  const marketId =
    actor.role === "super_admin"
      ? req.nextUrl.searchParams.get("market_id") ?? ""
      : actor.market_id ?? "";
  if (!marketId) {
    return NextResponse.json(
      { error: "market_id required for super_admin" },
      { status: 400 },
    );
  }
  if (!canViewOrders(actor.role, marketId, actor.market_id ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  let query = supabase
    .from("orders")
    .select(
      "status, rejection_reason, product_id, product_name, customer_city, carrier_id, created_at",
    )
    .eq("market_id", marketId)
    .in("status", TERMINAL_STATUSES)
    .gte("created_at", fromDate)
    .lte("created_at", `${toDate}T23:59:59.999Z`);

  // Optional filters narrow the scope (product/carrier/city/reason)
  const productId = req.nextUrl.searchParams.get("product_id");
  if (productId) query = query.eq("product_id", productId);

  const carrierId = req.nextUrl.searchParams.get("carrier_id");
  if (carrierId) query = query.eq("carrier_id", carrierId);

  const city = req.nextUrl.searchParams.get("city");
  if (city) query = query.eq("customer_city", city);

  const statusFilter = req.nextUrl.searchParams.get("status");
  if (statusFilter) {
    const list = statusFilter
      .split(",")
      .map((s) => s.trim())
      .filter((s) => (TERMINAL_STATUSES as readonly string[]).includes(s));
    if (list.length > 0) query = query.in("status", list);
  }

  const { data, error } = await query.order("created_at", { ascending: false }).limit(MAX_ROWS);
  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const rows = (data ?? []) as TerminalRow[];

  const outcomes = { delivered: 0, returned: 0, rejected: 0, cancelled: 0 };
  const rejectionReasons: Record<RejectionReason, number> = Object.fromEntries(
    REJECTION_REASONS.map((r) => [r, 0]),
  ) as Record<RejectionReason, number>;

  const returnedProducts = new Map<string, { product_id: string; product_name: string; count: number }>();
  const returnedCities = new Map<string, { city: string; count: number }>();
  const returnedCarriers = new Map<string, { carrier_id: string; count: number }>();

  const cohortBuckets = new Map<string, { week: string; delivered: number; returned: number; rejected: number; cancelled: number }>();

  for (const r of rows) {
    if (r.status in outcomes) outcomes[r.status as keyof typeof outcomes]++;

    if (r.status === "rejected" && r.rejection_reason) {
      rejectionReasons[r.rejection_reason] = (rejectionReasons[r.rejection_reason] ?? 0) + 1;
    }

    if (r.status === "returned") {
      if (r.product_id) {
        const key = r.product_id;
        const entry = returnedProducts.get(key);
        if (entry) entry.count++;
        else returnedProducts.set(key, { product_id: key, product_name: r.product_name ?? "", count: 1 });
      }
      if (r.customer_city) {
        const key = r.customer_city;
        const entry = returnedCities.get(key);
        if (entry) entry.count++;
        else returnedCities.set(key, { city: key, count: 1 });
      }
      if (r.carrier_id) {
        const key = r.carrier_id;
        const entry = returnedCarriers.get(key);
        if (entry) entry.count++;
        else returnedCarriers.set(key, { carrier_id: key, count: 1 });
      }
    }

    const wk = isoWeekKey(r.created_at);
    const bucket = cohortBuckets.get(wk) ?? { week: wk, delivered: 0, returned: 0, rejected: 0, cancelled: 0 };
    if (r.status in outcomes) bucket[r.status as keyof typeof outcomes]++;
    cohortBuckets.set(wk, bucket);
  }

  return NextResponse.json({
    data: {
      total: rows.length,
      outcomes,
      rejectionReasons,
      topReturnedProducts: topN(returnedProducts, 10),
      topReturnCities: topN(returnedCities, 10),
      topReturnCarriers: topN(returnedCarriers, 10),
      cohorts: Array.from(cohortBuckets.values()).sort((a, b) => a.week.localeCompare(b.week)),
    },
  });
}
