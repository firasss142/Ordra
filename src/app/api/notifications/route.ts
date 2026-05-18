import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
