import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewFinanceSection } from "@/lib/finance-permissions";
import { adsetBelongs, loadAccount, parseDraft, previewDraft } from "@/lib/meta-ads/mapping";
import { withRouteErrors } from "@/lib/journal/route-errors";

/**
 * What a mapping change WOULD move — money per product, the target's own split
 * with the orders behind it, and every issued investor statement whose period it
 * rewrites. Writes nothing. Same body as POST /api/meta/mapping, same code path
 * as the save, so the screen cannot promise something the ledger will not do.
 */

export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  if (!canViewFinanceSection(actorResult.actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = parseDraft(await req.json().catch(() => null), { requireUuids: true });
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const admin = createAdminClient();
  const account = await loadAccount(admin, parsed.draft.ad_account_id);
  if (!account || account.market_id !== parsed.draft.market_id) {
    return NextResponse.json({ error: "Unknown ad account for this market" }, { status: 404 });
  }
  if (
    parsed.draft.adset_id &&
    !(await adsetBelongs(admin, {
      adAccountId: parsed.draft.ad_account_id,
      campaignId: parsed.draft.campaign_id,
      adsetId: parsed.draft.adset_id,
    }))
  ) {
    return NextResponse.json({ error: "Unknown ad set for this campaign" }, { status: 404 });
  }

  try {
    const data = await previewDraft(admin, parsed.draft, account);
    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 },
    );
  }
}

export const POST = withRouteErrors("/api/meta/mapping/preview", "POST", handlePOST);
