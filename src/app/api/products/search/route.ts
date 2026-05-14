import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  const marketId =
    actor.role === "super_admin"
      ? (req.nextUrl.searchParams.get("market_id") ?? actor.market_id ?? "")
      : (actor.market_id ?? "");

  const q = req.nextUrl.searchParams.get("q");

  let query = supabase
    .from("products")
    .select("id, market_id, name, default_price, current_stock, is_active, product_variants(id, label, is_active)")
    .eq("market_id", marketId)
    .eq("is_active", true);

  if (q) {
    query = query.ilike("name", `%${q}%`);
  }

  const { data, error } = await query.order("name");

  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  const normalized = (data ?? []).map(({ default_price, ...rest }) => ({
    ...rest,
    unit_price: default_price ?? 0,
  }));

  return NextResponse.json(
    { data: normalized },
    {
      headers: {
        "Cache-Control": "private, max-age=60, stale-while-revalidate=600",
      },
    },
  );
}
