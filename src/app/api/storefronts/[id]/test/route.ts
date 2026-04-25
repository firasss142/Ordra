import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canManageStorefronts } from "@/lib/settings-permissions";
import { decrypt } from "@/lib/crypto";

interface TestResult {
  success: boolean;
  stage: "decrypt" | "signature" | "adapter" | "handler" | "ok";
  message: string;
  details?: Record<string, unknown>;
}

function buildTestPayload(platform: string): Record<string, unknown> {
  if (platform === "easy_orders") {
    return {
      event: "order.created",
      order: {
        id: `test_${Date.now()}`,
        customer: {
          name: "TEST — Do Not Process",
          phone: "+00000000000",
          address: "Test address",
          city: "Test",
          note: "integration test payload",
        },
        product: {
          name: "__oms_test_product__",
          quantity: 1,
          unit_price: 0,
          total_price: 0,
        },
      },
    };
  }
  return { test: true, platform };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canManageStorefronts(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  const { data: storefront, error: sfError } = await admin
    .from("storefronts")
    .select("id, market_id, platform, webhook_secret, is_active")
    .eq("id", id)
    .single();

  if (sfError || !storefront) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (actor.role !== "super_admin" && storefront.market_id !== actor.market_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Stage 1: decrypt secret
  let secret: string;
  try {
    secret = decrypt(storefront.webhook_secret);
  } catch {
    const result: TestResult = {
      success: false,
      stage: "decrypt",
      message: "Impossible de déchiffrer le secret webhook. Re-enregistrez le secret.",
    };
    return NextResponse.json(result, { status: 200 });
  }

  // Stage 2: build synthetic payload + signature
  const payload = buildTestPayload(storefront.platform);
  const rawBody = JSON.stringify(payload);
  const signature = createHmac("sha256", secret).update(rawBody).digest("hex");

  // Stage 3: invoke handler with replay flag so we don't actually create an order
  // The handler's signature validation path is exercised in allowReplay=false mode;
  // we deliberately use allowReplay here because we don't want the test payload to
  // persist. Instead, we validate the signature separately first.
  const testHeaders = new Headers({ "X-Webhook-Signature": signature });

  // Validate signature round-trip independently (proves secret integrity)
  const { getAdapter } = await import("@/lib/storefronts/adapter-registry");
  let adapter;
  try {
    adapter = getAdapter(storefront.platform);
  } catch {
    const result: TestResult = {
      success: false,
      stage: "adapter",
      message: `Adaptateur introuvable pour la plateforme: ${storefront.platform}`,
    };
    return NextResponse.json(result, { status: 200 });
  }

  const sigOk = adapter.validateWebhook(testHeaders, rawBody, secret);
  if (!sigOk) {
    const result: TestResult = {
      success: false,
      stage: "signature",
      message: "Échec de la validation de la signature. Vérifiez le secret.",
    };
    return NextResponse.json(result, { status: 200 });
  }

  // Stage 4: dry-run through handler. Mark storefront inactive temporarily? No —
  // instead we rely on the adapter's parseEventType + mapToInternalOrder only.
  try {
    const event = adapter.parseEventType(payload);
    const mapped = adapter.mapToInternalOrder(payload);
    const result: TestResult = {
      success: true,
      stage: "ok",
      message: "Test réussi — signature valide, payload correctement analysé.",
      details: {
        event,
        mapped_external_id: mapped.external_id,
        platform: storefront.platform,
      },
    };
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const result: TestResult = {
      success: false,
      stage: "handler",
      message: err instanceof Error ? err.message : "Erreur d'analyse du payload",
    };
    return NextResponse.json(result, { status: 200 });
  }
}

