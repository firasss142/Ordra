import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewFinanceSection } from "@/lib/finance-permissions";
import { checkTimezone } from "@/lib/meta-ads/timezone";

/**
 * What the sync-health strip reads.
 *
 * A silent sync failure must never read as "you spent nothing" — zero spend and
 * a broken token look identical on a chart, and the second one is an emergency.
 * Everything here exists to make the difference visible: when the last run was,
 * whether the schedule is actually installed, and whether each account's
 * credential and timezone still hold.
 *
 * `meta_ad_accounts` is service-role only, so this route reads it and hands
 * back a credential-free projection.
 */

export const dynamic = "force-dynamic";

interface AccountRow {
  id: string;
  market_id: string;
  ad_account_id: string;
  account_name: string | null;
  account_currency: string;
  account_timezone: string | null;
  is_active: boolean;
  last_synced_at: string | null;
  last_sync_error: string | null;
  markets: { code: string; name: string } | null;
}

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (!canViewFinanceSection(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const marketId =
    actor.role === "super_admin" ? req.nextUrl.searchParams.get("market_id") : actor.market_id;

  const adminClient = createAdminClient();

  let accountsQuery = adminClient
    .from("meta_ad_accounts")
    .select(
      "id, market_id, ad_account_id, account_name, account_currency, account_timezone, is_active, last_synced_at, last_sync_error, markets(code, name)",
    )
    .order("created_at", { ascending: true });
  if (marketId) accountsQuery = accountsQuery.eq("market_id", marketId);

  let runsQuery = adminClient
    .from("ad_sync_runs")
    .select("id, ad_account_id, trigger, status, started_at, finished_at, rows_fetched, rows_upserted, rows_errored, error")
    .order("started_at", { ascending: false })
    .limit(1);
  if (marketId) runsQuery = runsQuery.eq("market_id", marketId);

  // Distinct campaigns currently carrying synced spend in this market. Counted
  // rather than paged: the strip needs a number, not the rows.
  let campaignsQuery = adminClient
    .from("ad_spend")
    .select("external_campaign_id")
    .eq("source", "meta")
    .eq("is_active", true)
    .not("external_campaign_id", "is", null)
    .limit(5000);
  if (marketId) campaignsQuery = campaignsQuery.eq("market_id", marketId);

  const [accountsRes, runsRes, campaignsRes, cronRes] = await Promise.all([
    accountsQuery,
    runsQuery,
    campaignsQuery,
    adminClient.rpc("meta_ads_cron_status"),
  ]);

  if (accountsRes.error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const accounts = ((accountsRes.data ?? []) as unknown as AccountRow[]).map((a) => ({
    id: a.id,
    market_id: a.market_id,
    market_name: a.markets?.name ?? null,
    ad_account_id: a.ad_account_id,
    account_name: a.account_name,
    account_currency: a.account_currency,
    account_timezone: a.account_timezone,
    is_active: a.is_active,
    last_synced_at: a.last_synced_at,
    last_sync_error: a.last_sync_error,
    timezone: checkTimezone(a.account_timezone, a.markets?.code ?? ""),
  }));

  const campaigns = new Set(
    ((campaignsRes.data ?? []) as { external_campaign_id: string | null }[])
      .map((r) => r.external_campaign_id)
      .filter((id): id is string => !!id),
  ).size;

  const lastRun = (runsRes.data ?? [])[0] ?? null;

  // `meta_ads_cron_status` returns zero rows when the job was never scheduled,
  // which is a meaningful state and not an error.
  const cron = Array.isArray(cronRes.data) ? (cronRes.data[0] ?? null) : null;

  return NextResponse.json({
    data: {
      accounts,
      last_run: lastRun,
      campaigns,
      cadence: cron,
      last_error:
        accounts.find((a) => a.last_sync_error)?.last_sync_error ?? lastRun?.error ?? null,
    },
  });
}
