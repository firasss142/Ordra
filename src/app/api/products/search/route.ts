import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  const requested = req.nextUrl.searchParams.get("market_id");

  let marketId: string;
  if (actor.role === "super_admin") {
    marketId = requested ?? actor.market_id ?? "";
  } else {
    if (requested && requested !== actor.market_id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    marketId = actor.market_id ?? "";
  }

  if (!marketId) {
    return NextResponse.json({ data: [] });
  }

  const q = req.nextUrl.searchParams.get("q");

  let query = supabase
    .from("products")
    .select(
      "id, market_id, name, default_price, current_stock, is_active, image_url, product_variants(id, label, is_active)",
    )
    .eq("market_id", marketId)
    .eq("is_active", true)
    // Redondant avec is_active tant qu'on n'archive que du désactivé, mais on ne
    // fait pas reposer l'exclusion d'un produit archivé sur un invariant tenu
    // ailleurs : la RPC pourrait changer, ce filtre non.
    .is("deleted_at", null);

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
