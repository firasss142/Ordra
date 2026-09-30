import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { isCronAuthorized } from "@/lib/cron/auth";
import { drainOutbox } from "@/lib/whatsapp/outbox";

/**
 * Drains `whatsapp_outbox` — the automatic lifecycle notices and the campaign
 * sends. Scheduled by pg_cron (`whatsapp-outbox-1min`), which calls this only
 * when a row is due; see docs/notifications-cron.md. Never from Vercel's
 * `crons` key (Hobby plan; a sub-daily entry fails every deployment).
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function run(req: NextRequest): Promise<NextResponse> {
  if (!isCronAuthorized(req, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // pg_net gives up at 55 s and the function is killed at 60. Claiming stops
  // at 42 s and the last writes have room.
  const result = await drainOutbox(createAdminClient(), { trigger: "cron", deadlineAt: Date.now() + 45_000 });
  return NextResponse.json({ ok: result.status !== "failed", ...result }, { status: result.status === "failed" ? 500 : 200 });
}

export const GET = run;
export const POST = run;
