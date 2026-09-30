import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { loadConfigForMarket } from "@/lib/whatsapp/config";
import { resolveMarketForRead } from "@/lib/whatsapp/authz";

/**
 * GET /api/whatsapp/availability?market_id= — is the business number live
 * for this market? What every agent surface reads before showing a send
 * button instead of today's wa.me link. Never a secret: status only.
 */

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const access = resolveMarketForRead(actorResult.actor, new URL(req.url).searchParams.get("market_id"));
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const cfg = await loadConfigForMarket(createAdminClient(), access.marketId);
  return NextResponse.json({
    data: {
      market_id: access.marketId,
      connected: Boolean(cfg),
      active: Boolean(cfg && cfg.status === "active" && !cfg.decryptFailed),
      status: cfg?.status ?? null,
      display_phone: cfg?.displayPhone ?? null,
      verified_name: cfg?.verifiedName ?? null,
      messaging_limit_tier: cfg?.messagingLimitTier ?? null,
      quality_rating: cfg?.qualityRating ?? null,
    },
  });
}
