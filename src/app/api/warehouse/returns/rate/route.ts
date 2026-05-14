import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";

export const dynamic = "force-dynamic";

interface RateRow {
  product_id: string;
  market_id: string | null;
  delivered_count: number;
  returned_count: number;
  damaged_count: number;
}

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const single = url.searchParams.get("product_id");
  const multi = url.searchParams.getAll("product_ids");
  const ids = single ? [single] : multi;
  if (ids.length === 0) {
    return NextResponse.json(
      { error: "product_id or product_ids required" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  let query = supabase
    .from("product_return_rate_view")
    .select("product_id, market_id, delivered_count, returned_count, damaged_count")
    .in("product_id", ids);

  if (actor.role !== "super_admin" && actor.market_id) {
    query = query.eq("market_id", actor.market_id);
  }

  const { data, error } = (await query) as unknown as {
    data: RateRow[] | null;
    error: { message: string } | null;
  };

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = data ?? [];
  const rates = rows.map((r) => {
    const total = r.delivered_count + r.returned_count + r.damaged_count;
    const returnRate =
      total === 0 ? 0 : ((r.returned_count + r.damaged_count) / total) * 100;
    return {
      product_id: r.product_id,
      market_id: r.market_id,
      delivered: r.delivered_count,
      returned: r.returned_count,
      damaged: r.damaged_count,
      total,
      return_rate_percent: Math.round(returnRate * 10) / 10,
    };
  });

  return NextResponse.json(
    { rates },
    {
      headers: {
        "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
      },
    },
  );
}
