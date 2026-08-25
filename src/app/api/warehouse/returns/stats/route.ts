import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";
import { resolveWarehouseScope } from "@/lib/warehouse/scope";

export const dynamic = "force-dynamic";

export interface ReturnsStats {
  queueCount: number;
  queueValue: number;
  oldestDays: number;
  doneToday: number;
  doneTodayValue: number;
  restockedToday: number;
  depreciatedToday: number;
  depreciatedUnits: number;
  depreciatedValue: number;
  /** Null when the window holds no terminal order — a rate needs a denominator. */
  rate28d: number | null;
  ratePrev28d: number | null;
  /**
   * How many terminal orders each rate rests on. Tunisia's 28-day window holds
   * three, which yields "100 %" — arithmetically right and a coin toss dressed
   * as a metric. The console withholds a rate below MIN_RATE_SAMPLE.
   */
  sample28d: number;
  samplePrev28d: number;
  /** Four weekly points, oldest first (S-4 → S-1). */
  weekly: Array<{ week: number; rate: number | null }>;
  /**
   * Mean minutes from "marked coming back" to a decision, over 28 days.
   * Null when nothing was processed. Read it WITH processedSample: today one
   * market's figure rests on three parcels averaging 115 days each.
   */
  avgProcessingMinutes: number | null;
  processedSample: number;
  currency: string;
}

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { marketId, currency } = resolveWarehouseScope(req, actor);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_warehouse_returns_stats", {
    p_market_id: marketId,
  });

  if (error) {
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  const d = (data ?? {}) as Record<string, unknown>;
  const body: ReturnsStats = {
    queueCount: Number(d.queue_count ?? 0),
    queueValue: Number(d.queue_value ?? 0),
    oldestDays: Number(d.oldest_days ?? 0),
    doneToday: Number(d.done_today ?? 0),
    doneTodayValue: Number(d.done_today_value ?? 0),
    restockedToday: Number(d.restocked_today ?? 0),
    depreciatedToday: Number(d.depreciated_today ?? 0),
    depreciatedUnits: Number(d.depreciated_units ?? 0),
    depreciatedValue: Number(d.depreciated_value ?? 0),
    rate28d: d.rate_28d === null || d.rate_28d === undefined ? null : Number(d.rate_28d),
    sample28d: Number(d.sample_28d ?? 0),
    samplePrev28d: Number(d.sample_prev_28d ?? 0),
    ratePrev28d:
      d.rate_prev_28d === null || d.rate_prev_28d === undefined ? null : Number(d.rate_prev_28d),
    weekly: Array.isArray(d.weekly)
      ? (d.weekly as Array<{ week: number; rate: number | null }>)
      : [],
    avgProcessingMinutes:
      d.avg_processing_minutes === null || d.avg_processing_minutes === undefined
        ? null
        : Number(d.avg_processing_minutes),
    processedSample: Number(d.processed_sample ?? 0),
    currency,
  };

  return NextResponse.json(body, {
    headers: { "Cache-Control": "private, max-age=5, stale-while-revalidate=30" },
  });
}
