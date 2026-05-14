import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

interface SourceRow {
  market_id: string;
  customer_phone: string | null;
  customer_phone_2: string | null;
  customer_name: string | null;
  customer_address: string | null;
  customer_city: string | null;
  assigned_to?: string | null;
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  const source = req.nextUrl.searchParams.get("source");
  const id = req.nextUrl.searchParams.get("id");

  if ((source !== "order" && source !== "lead") || !id) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const table = source === "order" ? "orders" : "leads";
  const { data: row, error } = await supabase
    .from(table)
    .select(
      "id, market_id, customer_phone, customer_phone_2, customer_name, customer_address, customer_city, assigned_to",
    )
    .eq("id", id)
    .maybeSingle<SourceRow & { id: string; customer_phone_2?: string | null }>();

  if (error || !row) {
    // RLS will hide rows the caller can't see; treat as 404.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Extra defensive scoping for super_admin not needed; RLS already gates access.
  // For agents on the leads table, leads has its own RLS — the read above
  // already enforces it.

  const { data: detail, error: rpcErr } = await supabase.rpc(
    "get_customer_history_detail",
    {
      p_market_id: row.market_id,
      p_phone: row.customer_phone ?? "",
      p_phone_2: row.customer_phone_2 ?? "",
      p_name: row.customer_name ?? "",
      p_address: row.customer_address ?? "",
      p_city: row.customer_city ?? "",
      p_exclude_order_id: source === "order" ? id : null,
      p_exclude_lead_id: source === "lead" ? id : null,
    },
  );

  if (rpcErr) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  void actor;
  return NextResponse.json({ data: detail ?? { orders: [], leads: [], stats: {} } });
}
