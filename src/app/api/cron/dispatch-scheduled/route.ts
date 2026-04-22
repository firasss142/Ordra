import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { performDispatch } from "@/lib/carriers/perform-dispatch";

export const dynamic = "force-dynamic";

type ReadyRow = {
  order_id: string;
  carrier_id: string;
  scheduled_at: string;
};

export async function POST(req: NextRequest) {
  const expected = process.env.CRON_SECRET ?? "";
  if (!expected) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 500 }
    );
  }

  const header = req.headers.get("x-cron-secret");
  if (header !== expected) {
    return NextResponse.json({ error: "Forbidden" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: rows, error } = await admin.rpc("dispatch_scheduled_ready", {
    p_limit: 50,
  });

  if (error) {
    return NextResponse.json(
      { error: "Failed to fetch ready rows", detail: error.message },
      { status: 500 }
    );
  }

  const ready: ReadyRow[] = (rows ?? []) as ReadyRow[];

  const results: Array<{
    order_id: string;
    ok: boolean;
    error?: string;
  }> = [];

  for (const row of ready) {
    // Step 1: dispatch_scheduled → confirmed (clears scheduled_dispatch_* cols)
    const { error: promoteError } = await admin.rpc("transition_order_status", {
      p_order_id: row.order_id,
      p_new_status: "confirmed",
      p_actor_id: null,
      p_actor_type: "system",
      p_note: "Promu depuis dispatch_scheduled pour auto-expédition",
      p_rejection_reason: null,
      p_rejection_note: null,
      p_callback_at: null,
      p_scheduled_at: null,
      p_scheduled_auto: null,
      p_scheduled_carrier_id: null,
    });

    if (promoteError) {
      results.push({
        order_id: row.order_id,
        ok: false,
        error: `promote failed: ${promoteError.message}`,
      });
      continue;
    }

    // Step 2: confirmed → dispatched via the normal dispatch flow
    const result = await performDispatch({
      orderId: row.order_id,
      carrierId: row.carrier_id,
      actorId: null,
    });

    if (result.ok) {
      results.push({ order_id: row.order_id, ok: true });
    } else {
      results.push({
        order_id: row.order_id,
        ok: false,
        error: `dispatch failed: ${result.error}`,
      });
    }
  }

  return NextResponse.json({
    processed: ready.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}
