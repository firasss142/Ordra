import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// Accepts the manual-test header `x-cron-secret: <s>` AND Vercel Cron's
// `Authorization: Bearer <s>` so the same route works for local POST testing
// and for the scheduled GET from Vercel.
function isAuthorized(req: NextRequest, expected: string): boolean {
  if (!expected) return false;

  const xSecret = req.headers.get("x-cron-secret");
  if (xSecret && timingSafeEqual(xSecret, expected)) return true;

  const auth = req.headers.get("authorization") ?? "";
  if (auth.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length);
    if (timingSafeEqual(token, expected)) return true;
  }

  return false;
}

async function run(req: NextRequest) {
  const expected = process.env.CRON_SECRET ?? "";
  if (!isAuthorized(req, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();

  // 0. Auto-resolve any open notifications whose underlying order has moved
  // out of the kind's source state. Run as a single SQL pass via RPC so it
  // doesn't N+1 against the orders table.
  let resolvedCount = 0;
  {
    const { data, error } = await admin.rpc("resolve_stale_notifications");
    if (!error && typeof data === "number") {
      resolvedCount = data;
    }
  }

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
    resolved: resolvedCount,
  });
}

export const GET = run;
export const POST = run;
