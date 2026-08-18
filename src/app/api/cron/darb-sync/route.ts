import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { handleDarbSyncCronRequest } from "./handler";

/**
 * POST /api/cron/darb-sync
 *
 * Scheduled Darb Assabil status sweep, driven by pg_cron (see
 * 20260909000003_pg_cron_darb_sync.sql) — NOT by vercel.json `crons`, which
 * fails Hobby config validation on a sub-daily schedule and breaks every deploy.
 *
 * This is what makes Darb status independent of anyone having the app open.
 * Previously the only trigger was a QueuePage mount, so overnight, weekends and
 * holidays were dead zones for the entire Libya market.
 *
 * Auth: `x-cron-secret` compared in constant time against CRON_SECRET.
 *
 * Optional `?since=<ISO>` runs a delta sweep (stops at the first page with
 * nothing newer). Omit for a full sweep — at ~3 requests per account there is
 * little reason not to.
 */

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const since = req.nextUrl.searchParams.get("since");
  const result = await handleDarbSyncCronRequest({
    headers: req.headers,
    expectedSecret: process.env.CRON_SECRET ?? "",
    admin: createAdminClient(),
    since,
  });
  return NextResponse.json(result.body, { status: result.status });
}
