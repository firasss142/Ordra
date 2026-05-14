import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canManageStorefronts } from "@/lib/settings-permissions";
import { decrypt } from "@/lib/crypto";

export const dynamic = "force-dynamic";

interface TestResult {
  success: boolean;
  stage: "decrypt" | "signature" | "adapter" | "handler" | "ok";
  message: string;
  details?: Record<string, unknown>;
}

interface TestRequest {
  rawBody: string;
  headers: Headers;
}

function buildTestRequest(platform: string, secret: string): TestRequest {
  const ts = Date.now();
  const externalId = `oms-test-${ts}`;

  if (platform === "easy_orders") {
    const payload = {
      event: "order.created",
      order: {
        id: externalId,
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
    const rawBody = JSON.stringify(payload);
    const sig = createHmac("sha256", secret).update(rawBody).digest("hex");
    return {
      rawBody,
      headers: new Headers({ "X-Webhook-Signature": sig }),
    };
  }

  if (platform === "shopify") {
    const payload = {
      id: externalId,
      note: "integration test payload",
      total_price: "0.00",
      customer: {
        first_name: "TEST",
        last_name: "Do Not Process",
        phone: "+00000000000",
      },
      shipping_address: {
        first_name: "TEST",
        last_name: "Do Not Process",
        name: "TEST Do Not Process",
        phone: "+00000000000",
        address1: "Test address",
        city: "Test",
      },
      line_items: [
        {
          id: 1,
          name: "__oms_test_product__",
          sku: null,
          variant_title: null,
          quantity: 1,
          price: "0.00",
        },
      ],
    };
    const rawBody = JSON.stringify(payload);
    const sig = createHmac("sha256", secret)
      .update(rawBody, "utf8")
      .digest("base64");
    return {
      rawBody,
      headers: new Headers({
        "X-Shopify-Hmac-Sha256": sig,
        "X-Shopify-Topic": "orders/create",
      }),
    };
  }

  if (platform === "woocommerce") {
    const payload = {
      id: externalId,
      customer_note: "integration test payload",
      total: "0.00",
      billing: {
        first_name: "TEST",
        last_name: "Do Not Process",
        phone: "+00000000000",
        address_1: "Test address",
        address_2: "",
        city: "Test",
        email: "test@example.com",
      },
      line_items: [
        {
          id: 1,
          name: "__oms_test_product__",
          sku: null,
          variation_id: 0,
          quantity: 1,
          price: 0,
        },
      ],
    };
    const rawBody = JSON.stringify(payload);
    const sig = createHmac("sha256", secret)
      .update(rawBody, "utf8")
      .digest("base64");
    return {
      rawBody,
      headers: new Headers({
        "X-WC-Webhook-Signature": sig,
        "X-WC-Webhook-Topic": "order.created",
      }),
    };
  }

  if (platform === "lightfunnels") {
    const payload = {
      node: {
        id: externalId,
        _id: ts,
        name: "TEST",
        email: "test@example.com",
        phone: "+00000000000",
        total: 0,
        currency: "USD",
        customer: {
          full_name: "TEST Do Not Process",
          first_name: "TEST",
          last_name: "Do Not Process",
        },
        billing_address: {
          line1: "Test address",
          city: "Test",
          phone: "+00000000000",
          first_name: "TEST",
          last_name: "Do Not Process",
        },
        shipping_address: {
          line1: "Test address",
          city: "Test",
          phone: "+00000000000",
          first_name: "TEST",
          last_name: "Do Not Process",
        },
        items: [
          {
            id: "test-item",
            sku: "",
            title: "__oms_test_product__",
            price: 0,
            quantity: 1,
          },
        ],
      },
    };
    const rawBody = JSON.stringify(payload);
    const sig = createHmac("sha256", secret)
      .update(rawBody, "utf8")
      .digest("base64");
    return {
      rawBody,
      headers: new Headers({
        "lightfunnels-hmac": sig,
        "lightfunnels-topic": "order/created",
      }),
    };
  }

  // Fallback (unknown platform — won't reach adapter happy path)
  const rawBody = JSON.stringify({ test: true, platform });
  return { rawBody, headers: new Headers() };
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

  // Stage 2: build per-platform synthetic payload + signature + headers
  const { rawBody, headers: testHeaders } = buildTestRequest(
    storefront.platform,
    secret,
  );

  // Stage 3: resolve adapter
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

  // Stage 4: validate signature round-trip (proves secret integrity end-to-end)
  const sigOk = adapter.validateWebhook(testHeaders, rawBody, secret);
  if (!sigOk) {
    const result: TestResult = {
      success: false,
      stage: "signature",
      message: "Échec de la validation de la signature. Vérifiez le secret.",
    };
    return NextResponse.json(result, { status: 200 });
  }

  // Stage 5: parse + map (dry-run, no DB writes)
  try {
    const payload = JSON.parse(rawBody);
    const event = adapter.parseEventType(payload, testHeaders);
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
