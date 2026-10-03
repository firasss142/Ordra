import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * Manual trigger for the nightly availability reset.
 *
 * The schedule itself runs in-database (pg_cron, hourly at :22, acting only
 * inside the first hour of each market's local midnight). This route exists so
 * a stalled schedule can always be run by hand — the same lesson the investor
 * rollup wrote down after a stuck job could only be cleared by waiting.
 *
 * It is idempotent for the same reason the cron is: the function refuses to
 * reset a market twice in one local day.
 */
async function handlePOST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (actor.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Service role: the function is granted to service_role only, and it writes
  // an append-only log that RLS forbids the caller from touching directly.
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("reset_agent_availability_daily");

  if (error) {
    console.error("[POST /api/team/availability/reset] rpc failed", {
      code: error.code,
      message: error.message,
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data });
}

export const POST = withRouteErrors("/api/team/availability/reset", "POST", handlePOST);
