import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { loadConfigForMarket } from "@/lib/whatsapp/config";
import { createWhatsAppClient } from "@/lib/whatsapp/client";
import { syncTemplatesFromMeta } from "@/lib/whatsapp/templates";
import { resolveMarketForManage } from "@/lib/whatsapp/authz";
import { withRouteErrors } from "@/lib/journal/route-errors";

/** « Synchroniser depuis Meta » — mirror Meta's template list into the registry. */

export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const body = (await req.json().catch(() => ({}))) as { market_id?: string };
  const access = resolveMarketForManage(actorResult.actor, body.market_id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const admin = createAdminClient({ actorId: actorResult.actor.id });
  const cfg = await loadConfigForMarket(admin, access.marketId);
  if (!cfg || cfg.status !== "active" || cfg.decryptFailed) {
    return NextResponse.json({ error: "config_inactive", message: "Connectez d'abord WhatsApp dans Système › Connexions." }, { status: 409 });
  }

  try {
    const result = await syncTemplatesFromMeta(admin, cfg, createWhatsAppClient(cfg));
    return NextResponse.json({ data: result });
  } catch (err) {
    return NextResponse.json({ error: "graph_failed", message: err instanceof Error ? err.message : "Meta injoignable" }, { status: 502 });
  }
}

export const POST = withRouteErrors("/api/whatsapp/templates/sync", "POST", handlePOST);
