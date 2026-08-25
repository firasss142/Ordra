import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";
import { resolveWarehouseScope } from "@/lib/warehouse/scope";

export const dynamic = "force-dynamic";

/**
 * How close the books were to the shelf at the last physical count.
 *
 * The mockup dashboard prints "Accuracy 99.5 %". There is no ground truth at
 * scan time — nothing tells us whether the sticker went on the right parcel —
 * so the only accuracy this warehouse can claim is the variance measured when
 * a human last counted. It is NULL until somebody counts: "never verified"
 * and "verified and correct" are opposite facts.
 */
export interface CountAccuracy {
  accuracy: number | null;
  counted_products: number;
  counts: number;
  products: Array<{
    product_id: string;
    last_counted_at: string;
    last_variance: number;
    accuracy: number;
  }>;
}

/** A count older than a quarter is not evidence about today's shelf. */
const ACCURACY_DAYS = 90;

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { marketId } = resolveWarehouseScope(req, actor);

  const { data, error } = await supabase.rpc("get_count_accuracy", {
    p_market_id: marketId,
    p_days: ACCURACY_DAYS,
  });
  if (error) {
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  const d = (data ?? {}) as Partial<CountAccuracy>;
  return NextResponse.json(
    {
      accuracy: d.accuracy ?? null,
      counted_products: d.counted_products ?? 0,
      counts: d.counts ?? 0,
      products: d.products ?? [],
    } satisfies CountAccuracy,
    { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=120" } },
  );
}
