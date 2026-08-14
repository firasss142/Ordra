import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { encrypt } from "@/lib/crypto";
import { fetchAccountMeta, MetaApiError } from "@/lib/meta-ads/client";

/**
 * Update or disconnect one Meta ad account.
 *
 * Rotating a token re-verifies it against Graph first, for the same reason the
 * initial save does: a bad credential that lands in the table turns into a
 * finance page reporting zero spend, and zero is indistinguishable from "we
 * paused the ads" until someone goes looking.
 */

export const dynamic = "force-dynamic";

const PUBLIC_COLUMNS =
  "id, market_id, ad_account_id, business_id, account_name, account_currency, account_timezone, graph_version, token_expires_at, is_active, last_synced_at, last_sync_error";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  if (actorResult.actor.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const adminClient = createAdminClient();

  const { data: existing, error: loadError } = await adminClient
    .from("meta_ad_accounts")
    .select("id, ad_account_id, graph_version")
    .eq("id", params.id)
    .maybeSingle();

  if (loadError) return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (typeof body.is_active === "boolean") patch.is_active = body.is_active;
  if (typeof body.graph_version === "string" && body.graph_version) {
    patch.graph_version = body.graph_version;
  }

  // A rotated token is verified before it replaces the working one.
  if (typeof body.access_token === "string" && body.access_token.trim()) {
    const token = body.access_token.trim();
    try {
      const meta = await fetchAccountMeta({
        adAccountId: existing.ad_account_id,
        accessToken: token,
        graphVersion: (patch.graph_version as string) ?? existing.graph_version,
      });
      patch.account_name = meta.name;
      patch.account_currency = meta.currency;
      patch.account_timezone = meta.timezoneName;
    } catch (err) {
      const apiError = err instanceof MetaApiError ? err : null;
      return NextResponse.json(
        {
          error: apiError?.isAuthFailure ? "invalid_token" : "meta_unreachable",
          message: err instanceof Error ? err.message : "Could not reach Meta",
        },
        { status: 400 },
      );
    }
    patch.access_token = encrypt(token);
    // The stored error described the old credential. Keeping it would leave a
    // freshly-rotated account showing a failure it no longer has.
    patch.last_sync_error = null;
  }

  const { data, error } = await adminClient
    .from("meta_ad_accounts")
    .update(patch)
    .eq("id", params.id)
    .select(PUBLIC_COLUMNS)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  if (actorResult.actor.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // A hard delete, deliberately. The row is configuration plus a credential;
  // there is nothing here worth keeping once it is disconnected, and leaving a
  // soft-deleted token at rest is strictly worse than removing it. Everything
  // it wrote into `ad_spend` survives — that is history, not configuration.
  const { error } = await createAdminClient()
    .from("meta_ad_accounts")
    .delete()
    .eq("id", params.id);

  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data: { deleted: true } });
}
