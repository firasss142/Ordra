import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();

  let query = supabase
    .from("orders")
    .select(
      "id, customer_name, customer_phone, customer_city, customer_address, product_name, variant_label, quantity, total_price, status, created_at"
    )
    .eq("status", "to_be_returned")
    .order("created_at", { ascending: true })
    .limit(200);

  if (actor.role !== "super_admin" && actor.market_id) {
    query = query.eq("market_id", actor.market_id);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  return NextResponse.json(
    { orders: data ?? [] },
    {
      headers: {
        "Cache-Control": "private, max-age=2",
      },
    }
  );
}
