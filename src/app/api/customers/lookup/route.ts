import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewOrders } from "@/lib/order-permissions";
import { toNationalDigits } from "@/lib/orders/search-query";

export const dynamic = "force-dynamic";

/**
 * Who this phone number belongs to, for the create-order panel.
 *
 * Distinct from /api/customers/search, which serves the follow-ups feature and
 * only ever returns orders in follow-up-eligible statuses — a customer whose
 * five orders were all delivered is invisible to it. This one answers a
 * different question: "have we sold to this number before, and what did we
 * write down about them last time".
 *
 * Matched on national digits, because the same customer's number is stored
 * three ways in this data (`925782017`, `0925782017`, `+218925782017`) and a
 * literal comparison finds one of the three.
 */
export interface CustomerLookup {
  phone: string;
  name: string | null;
  city: string | null;
  address: string | null;
  orderCount: number;
  /** ISO timestamp of the most recent order, or null if somehow none. */
  lastOrderAt: string | null;
}

/** Below this a lookup matches half the market and means nothing. */
const MIN_DIGITS = 6;

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const actorMarketId = actor.market_id ?? "";

  const rawPhone = (req.nextUrl.searchParams.get("phone") ?? "").trim();
  const digits = toNationalDigits(rawPhone);
  if (digits.length < MIN_DIGITS) {
    return NextResponse.json({ data: null });
  }

  const marketId =
    actor.role === "super_admin"
      ? req.nextUrl.searchParams.get("market_id") ?? null
      : actorMarketId;

  if (marketId && !canViewOrders(actor.role, marketId, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // A super_admin with no market in scope has no customer to look up: the same
  // digits can belong to two different people in two isolated markets.
  if (!marketId) return NextResponse.json({ data: null });

  const supabase = await createClient();
  const query = supabase
    .from("orders")
    .select("customer_name, customer_phone, customer_city, customer_address, created_at")
    .eq("market_id", marketId)
    .ilike("customer_phone", `%${digits}%`)
    .neq("status", "deleted")
    .order("created_at", { ascending: false })
    .limit(200);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: "Internal server error", detail: error.message },
      { status: 500 },
    );
  }

  const rows = data ?? [];
  if (rows.length === 0) return NextResponse.json({ data: null });

  // The newest order is the best record of who they are now — people move, and
  // an address from eleven months ago is not the one to prefill.
  const latest = rows[0] as {
    customer_name: string | null;
    customer_phone: string | null;
    customer_city: string | null;
    customer_address: string | null;
    created_at: string;
  };

  // Earlier rows fill gaps the latest order left blank rather than losing a
  // known address just because the most recent order arrived without one.
  const firstNonEmpty = (key: "customer_city" | "customer_address" | "customer_name") => {
    for (const r of rows) {
      const v = (r as Record<string, unknown>)[key];
      if (typeof v === "string" && v.trim() !== "") return v;
    }
    return null;
  };

  const result: CustomerLookup = {
    phone: latest.customer_phone ?? rawPhone,
    name: firstNonEmpty("customer_name"),
    city: firstNonEmpty("customer_city"),
    address: firstNonEmpty("customer_address"),
    orderCount: rows.length,
    lastOrderAt: latest.created_at ?? null,
  };

  return NextResponse.json(
    { data: result },
    { headers: { "Cache-Control": "private, max-age=10" } },
  );
}
