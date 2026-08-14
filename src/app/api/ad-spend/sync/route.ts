import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewFinanceSection } from "@/lib/finance-permissions";
import { syncAllAccounts } from "@/lib/meta-ads/sync";

/**
 * "Sync now" — the same code path as the hourly cron, triggered by a person.
 *
 * Worth having even though the cron is hourly: the first thing anyone does
 * after connecting an account is want to see whether it worked, and waiting up
 * to an hour to find out that a token was pasted wrong is a bad first
 * impression of an integration. `trigger` is recorded so a manual run failing
 * reads differently from the cron failing unattended.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canViewFinanceSection(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const adminClient = createAdminClient();
  const marketId = req.nextUrl.searchParams.get("market_id") ?? undefined;

  // Shorter budget than the cron: this one has a person waiting on it, and the
  // rolling window means an unfinished pass is picked up by the next tick.
  const deadlineAt = Date.now() + 40_000;

  try {
    const results = await syncAllAccounts(adminClient, {
      trigger: "manual",
      deadlineAt,
      marketId,
    });
    return NextResponse.json({ ok: true, results });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
