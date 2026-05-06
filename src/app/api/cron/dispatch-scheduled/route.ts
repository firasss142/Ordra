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
    // dispatch_scheduled → uploaded directly. dispatch_order accepts
    // dispatch_scheduled as a source and clears scheduled_dispatch_* on
    // success. On failure the row stays dispatch_scheduled and the next
    // cron run retries it.
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
        error: `upload failed: ${result.error}`,
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
