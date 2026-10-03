import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { loadConfigForMarket } from "@/lib/whatsapp/config";
import { createWhatsAppClient } from "@/lib/whatsapp/client";
import { createMissingCatalogueTemplates } from "@/lib/whatsapp/templates";
import { resolveMarketForManage } from "@/lib/whatsapp/authz";
import { withRouteErrors } from "@/lib/journal/route-errors";

/**
 * « Créer les modèles Ordra » — submit the catalogue in both languages and
 * map each lifecycle template to its event. The sample header image for
 * product_share is read from public/ and pushed through Meta's resumable
 * upload once per call.
 */

export const dynamic = "force-dynamic";

async function readSampleImage() {
  const file = path.join(process.cwd(), "public", "whatsapp", "product-sample.jpg");
  const buf = await readFile(file);
  return { bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), mime: "image/jpeg", name: "product-sample.jpg" };
}

async function handlePOST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const body = (await req.json().catch(() => ({}))) as { market_id?: string };
  const access = resolveMarketForManage(actorResult.actor, body.market_id);
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const admin = createAdminClient();
  const cfg = await loadConfigForMarket(admin, access.marketId);
  if (!cfg || cfg.status !== "active" || cfg.decryptFailed) {
    return NextResponse.json({ error: "config_inactive", message: "Connectez d'abord WhatsApp dans Système › Connexions." }, { status: 409 });
  }

  try {
    const result = await createMissingCatalogueTemplates(admin, cfg, createWhatsAppClient(cfg), { readSampleImage });
    return NextResponse.json({ data: result });
  } catch (err) {
    return NextResponse.json({ error: "graph_failed", message: err instanceof Error ? err.message : "Meta injoignable" }, { status: 502 });
  }
}

export const POST = withRouteErrors("/api/whatsapp/templates/catalogue", "POST", handlePOST);
