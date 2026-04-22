import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-cron-secret");
  if (!secret || secret !== (process.env.CRON_SECRET ?? "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();

  // 1. Callback-due: callback_scheduled orders where callback_scheduled_at <= now
  const { data: callbackDue } = await admin
    .from("orders")
    .select("id, assigned_to, callback_scheduled_at")
    .eq("status", "callback_scheduled")
    .lte("callback_scheduled_at", now)
    .limit(200);

  // 2. Attempt-due: attempt_* orders where callback_scheduled_at (preset slot) <= now
  const { data: attemptDue } = await admin
    .from("orders")
    .select("id, assigned_to, callback_scheduled_at")
    .in("status", ["attempt_1", "attempt_2", "attempt_3"])
    .lte("callback_scheduled_at", now)
    .limit(200);

  let callbackCount = 0;
  let attemptCount = 0;

  if (callbackDue && callbackDue.length > 0) {
    const rows = callbackDue
      .filter((o: Record<string, unknown>) => o.assigned_to)
      .map((o: Record<string, unknown>) => ({
        agent_id: o.assigned_to,
        order_id: o.id,
        kind: "callback_due",
        due_at: (o.callback_scheduled_at as string) ?? now,
      }));

    if (rows.length > 0) {
      // Unique partial index on (order_id, kind) WHERE read_at IS NULL prevents duplicates
      await admin.from("agent_notifications").insert(rows);
      callbackCount = rows.length;
    }
  }

  if (attemptDue && attemptDue.length > 0) {
    const rows = attemptDue
      .filter((o: Record<string, unknown>) => o.assigned_to)
      .map((o: Record<string, unknown>) => ({
        agent_id: o.assigned_to,
        order_id: o.id,
        kind: "attempt_due",
        due_at: (o.callback_scheduled_at as string) ?? now,
      }));

    if (rows.length > 0) {
      await admin.from("agent_notifications").insert(rows);
      attemptCount = rows.length;
    }
  }

  return NextResponse.json({
    ok: true,
    callback_notifications: callbackCount,
    attempt_notifications: attemptCount,
  });
}
