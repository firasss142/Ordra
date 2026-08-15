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
  const params = req.nextUrl.searchParams;
  const marketId = params.get("market_id") ?? undefined;

  // An explicit range turns this into a backfill. It exists because the steady
  // -state window is seven days, and a campaign that stopped running before
  // that is invisible to the page — which reads as "this product has no ad
  // spend" rather than "we never asked Meta about it".
  const since = params.get("since");
  const until = params.get("until");
  const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
  if ((since || until) && !(ISO_DAY.test(since ?? "") && ISO_DAY.test(until ?? ""))) {
    return NextResponse.json(
      { ok: false, error: "since and until must both be YYYY-MM-DD" },
      { status: 400 },
    );
  }
  if (since && until && since > until) {
    return NextResponse.json({ ok: false, error: "since must not be after until" }, { status: 400 });
  }
  const window = since && until ? { since, until } : undefined;

  // Shorter budget than the cron: this one has a person waiting on it, and the
  // rolling window means an unfinished pass is picked up by the next tick. A
  // backfill that runs out of budget stops on a slice boundary and can simply
  // be run again — the upsert makes a repeat harmless.
  const deadlineAt = Date.now() + 40_000;

  try {
    const results = await syncAllAccounts(adminClient, {
      trigger: "manual",
      deadlineAt,
      marketId,
      window,
    });
    return NextResponse.json({ ok: true, results });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
