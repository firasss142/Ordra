import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { encrypt, maskCredential } from "@/lib/crypto";
import { fetchAccountMeta, MetaApiError } from "@/lib/meta-ads/client";
import { normaliseAccountId, isValidAccountId } from "@/lib/meta-ads/account-id";

/**
 * The Meta ad accounts the sync polls, and the credential it polls them with.
 *
 * `meta_ad_accounts` has RLS on with zero policies and no grants to
 * `authenticated` — the access token in it can read every figure in someone's
 * ad account, so it is reachable only through the service role, only here, and
 * only for a super_admin. The plaintext token leaves the browser exactly once,
 * on the POST that stores it, and is never sent back: reads return a mask.
 *
 * A token is verified against Graph BEFORE it is written. A credential that
 * fails on save is a five-second problem; one that fails silently at 03:07 is a
 * finance page reporting zero spend with nobody watching.
 */

export const dynamic = "force-dynamic";

interface AccountRow {
  id: string;
  market_id: string;
  ad_account_id: string;
  business_id: string | null;
  account_name: string | null;
  account_currency: string;
  account_timezone: string | null;
  graph_version: string;
  access_token: string;
  token_expires_at: string | null;
  is_active: boolean;
  last_synced_at: string | null;
  last_sync_error: string | null;
}

/** Never let `access_token` past this function. */
function toPublic(row: AccountRow) {
  const { access_token, ...rest } = row;
  return { ...rest, token_masked: maskCredential(access_token) };
}

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  if (actorResult.actor.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await createAdminClient()
    .from("meta_ad_accounts")
    .select(
      "id, market_id, ad_account_id, business_id, account_name, account_currency, account_timezone, graph_version, access_token, token_expires_at, is_active, last_synced_at, last_sync_error",
    )
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data: ((data ?? []) as AccountRow[]).map(toPublic) });
}

export async function POST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  if (actorResult.actor.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const marketId: string | undefined = body.market_id;
  const rawAccountId: string | undefined = body.ad_account_id;
  const accessToken: string | undefined = body.access_token;
  const graphVersion: string | undefined = body.graph_version;

  if (!marketId || !rawAccountId || !accessToken) {
    return NextResponse.json(
      { error: "market_id, ad_account_id and access_token are required" },
      { status: 400 },
    );
  }

  const adAccountId = normaliseAccountId(rawAccountId);
  if (!isValidAccountId(adAccountId)) {
    return NextResponse.json(
      { error: "invalid_account_id", message: "Ad account id must be numeric (act_123456 or 123456)." },
      { status: 400 },
    );
  }

  // Verify before storing. This also fills in name, currency and — the one that
  // cannot be corrected after the fact — the account's reporting timezone.
  let meta;
  try {
    meta = await fetchAccountMeta({ adAccountId, accessToken, graphVersion });
  } catch (err) {
    const apiError = err instanceof MetaApiError ? err : null;
    return NextResponse.json(
      {
        error: apiError?.isAuthFailure ? "invalid_token" : "meta_unreachable",
        message: err instanceof Error ? err.message : "Could not reach Meta",
        code: apiError?.code ?? null,
      },
      { status: 400 },
    );
  }

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("meta_ad_accounts")
    .upsert(
      {
        market_id: marketId,
        ad_account_id: adAccountId,
        account_name: meta.name,
        account_currency: meta.currency,
        account_timezone: meta.timezoneName,
        access_token: encrypt(accessToken),
        // A System User token is non-expiring by design; a 60-day token would
        // carry a date here and the sync would warn before it lapsed.
        token_expires_at: body.token_expires_at ?? null,
        graph_version: graphVersion || undefined,
        is_active: true,
        last_sync_error: null,
      },
      { onConflict: "ad_account_id" },
    )
    .select(
      "id, market_id, ad_account_id, business_id, account_name, account_currency, account_timezone, graph_version, access_token, token_expires_at, is_active, last_synced_at, last_sync_error",
    )
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data: toPublic(data as AccountRow) }, { status: 201 });
}
