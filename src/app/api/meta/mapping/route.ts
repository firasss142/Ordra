import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewFinanceSection } from "@/lib/finance-permissions";
import { adsetBelongs, loadAccount, loadMappingTree, parseDraft, previewDraft } from "@/lib/meta-ads/mapping";
import { rebuildMetaAdSpend } from "@/lib/meta-ads/rebuild";
import { accountTimezone } from "@/lib/meta-ads/sync";
import { withRouteErrors } from "@/lib/journal/route-errors";

/**
 * Campaign / ad set → product(s), effective-dated. The drawer's two verbs.
 *
 * GET  the whole catalogue with its spend, the mapping in force and its history
 *      — over the whole history unless from_date/to_date narrow the window.
 * POST one change: which products, how to split, and from when. Saved through
 *      set_ad_spend_mapping (history kept, never edited), then ad_spend is
 *      rewritten for exactly the range /preview named — never before the
 *      account's complete ad-set history, so a remap can only move money that
 *      is really there.
 *
 * No order carries ad attribution (utm, fbclid — all checked), so this is
 * asserted, not derived; and it moves money between products' margins and
 * investors' shares. Hence super_admin, like every finance surface.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

async function handleGET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  if (!canViewFinanceSection(actorResult.actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = req.nextUrl.searchParams;
  const marketId = params.get("market_id");
  if (!marketId) {
    return NextResponse.json({ error: "market_id query parameter required" }, { status: 400 });
  }

  // No dates = the whole history, which is what the drawer asks for: a
  // mapping holds for all of it.
  const from = params.get("from_date") ?? undefined;
  const to = params.get("to_date") ?? undefined;
  if ((from && !ISO_DAY.test(from)) || (to && !ISO_DAY.test(to)) || (from && to && from > to)) {
    return NextResponse.json({ error: "from_date and to_date must be YYYY-MM-DD, in order" }, { status: 400 });
  }

  try {
    const data = await loadMappingTree(createAdminClient(), { marketId, from, to });
    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}

async function handlePOST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (!canViewFinanceSection(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = parseDraft(await req.json().catch(() => null), { requireUuids: true });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { draft } = parsed;

  const admin = createAdminClient();
  const account = await loadAccount(admin, draft.ad_account_id);
  if (!account || account.market_id !== draft.market_id) {
    return NextResponse.json({ error: "Unknown ad account for this market" }, { status: 404 });
  }
  // A version for an ad set named with the wrong campaign would never resolve.
  if (
    draft.adset_id &&
    !(await adsetBelongs(admin, { adAccountId: draft.ad_account_id, campaignId: draft.campaign_id, adsetId: draft.adset_id }))
  ) {
    return NextResponse.json({ error: "Unknown ad set for this campaign" }, { status: 404 });
  }

  // Computed BEFORE the save: it is the "before" the response reports, and the
  // range the rewrite below is allowed to touch.
  const preview = await previewDraft(admin, draft, account);

  const { data: id, error } = await admin.rpc("set_ad_spend_mapping", {
    p_actor_id: actor.id,
    p_ad_account_id: draft.ad_account_id,
    p_campaign_id: draft.campaign_id,
    p_adset_id: draft.adset_id,
    p_effective_from: draft.effective_from,
    p_kind: draft.kind,
    p_split_mode: draft.split_mode,
    p_lines: draft.lines,
  });
  if (error) {
    const e = error as { message: string; code?: string };
    return NextResponse.json({ error: e.message }, { status: e.code === "22023" ? 400 : 500 });
  }

  // The mapping is saved. If the rewrite fails now, the next hourly sync
  // re-projects the whole complete history and heals it — say so rather than
  // reporting the save as failed, which would invite a duplicate version.
  let rowsRewritten = 0;
  let pendingRebuild = false;
  if (preview.range) {
    try {
      rowsRewritten = await rebuildMetaAdSpend(admin, {
        adAccountId: draft.ad_account_id,
        marketId: account.market_id,
        timezone: accountTimezone(account),
        since: preview.range.since,
        until: preview.range.until,
        campaignIds: [draft.campaign_id],
      });
    } catch {
      pendingRebuild = true;
    }
  }

  return NextResponse.json(
    { data: { id, rows_rewritten: rowsRewritten, pending_rebuild: pendingRebuild, preview } },
    { status: 201 },
  );
}

export const GET = withRouteErrors("/api/meta/mapping", "GET", handleGET);
export const POST = withRouteErrors("/api/meta/mapping", "POST", handlePOST);
