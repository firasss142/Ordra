import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { LY_MARKET_ID } from "@/lib/markets";
import { decrypt } from "@/lib/crypto";

interface ShippingEyesPriceResponse {
  code: number;
  message?: string;
  shipping_cost?: number | string;
  basic_cost?: number;
  extra_kilo_cost?: number;
  extra_weight?: number;
  extra_shipping_cost?: number;
  errors?: Record<string, string[]>;
}

export interface PriceResult {
  ok: boolean;
  shipping_cost?: number;
  breakdown?: {
    basic_cost: number;
    extra_kilo_cost: number;
    extra_weight: number;
    extra_shipping_cost: number;
  };
  reason?: "not_found" | "invalid_input" | "carrier_error" | "no_carrier";
  message?: string;
}

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  // Only super_admin or Libya-scoped roles can use this endpoint.
  if (actor.role !== "super_admin" && actor.market_id !== LY_MARKET_ID) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const stateId = sp.get("state_id");
  const placeId = sp.get("place_id");
  const womenDelivery = sp.get("women_delivery") ?? "0";
  const weight = sp.get("weight");

  if (!stateId) {
    return NextResponse.json(
      { ok: false, reason: "invalid_input", message: "state_id is required" } satisfies PriceResult,
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { data: carrier, error: carrierErr } = await admin
    .from("carriers")
    .select("id, code, api_endpoint, api_credentials, is_active, market_id")
    .eq("market_id", LY_MARKET_ID)
    .eq("code", "dexpress")
    .eq("is_active", true)
    .maybeSingle();

  if (carrierErr || !carrier || !carrier.api_credentials) {
    return NextResponse.json(
      { ok: false, reason: "no_carrier" } satisfies PriceResult,
      { status: 200 }
    );
  }

  let creds: Record<string, string>;
  try {
    creds = JSON.parse(decrypt(carrier.api_credentials));
  } catch {
    return NextResponse.json(
      { ok: false, reason: "carrier_error", message: "credentials" } satisfies PriceResult,
      { status: 200 }
    );
  }

  const baseUrl = (creds.api_base_url ?? carrier.api_endpoint ?? "").replace(/\/$/, "");
  const apiKey = creds.api_key;
  if (!baseUrl || !apiKey) {
    return NextResponse.json(
      { ok: false, reason: "carrier_error", message: "config" } satisfies PriceResult,
      { status: 200 }
    );
  }

  const formBody = new URLSearchParams({
    state_id: stateId,
    women_delivery: womenDelivery === "1" ? "1" : "0",
    ...(placeId ? { place_id: placeId } : {}),
    ...(weight ? { weight } : {}),
  }).toString();

  let res: Response;
  try {
    res = await fetch(`${baseUrl}/price-calculator`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: apiKey,
      },
      body: formBody,
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return NextResponse.json(
      { ok: false, reason: "carrier_error", message: "network" } satisfies PriceResult,
      { status: 200 }
    );
  }

  let body: ShippingEyesPriceResponse;
  try {
    body = (await res.json()) as ShippingEyesPriceResponse;
  } catch {
    return NextResponse.json(
      { ok: false, reason: "carrier_error", message: "parse" } satisfies PriceResult,
      { status: 200 }
    );
  }

  if (body.code === 4000 && body.shipping_cost !== undefined) {
    const cost = Number(body.shipping_cost);
    if (Number.isNaN(cost)) {
      return NextResponse.json(
        { ok: false, reason: "carrier_error", message: "non_numeric_cost" } satisfies PriceResult,
        { status: 200 }
      );
    }
    const result: PriceResult = { ok: true, shipping_cost: cost };
    if (
      typeof body.basic_cost === "number" &&
      typeof body.extra_kilo_cost === "number"
    ) {
      result.breakdown = {
        basic_cost: body.basic_cost,
        extra_kilo_cost: body.extra_kilo_cost,
        extra_weight: body.extra_weight ?? 0,
        extra_shipping_cost: body.extra_shipping_cost ?? 0,
      };
    }
    return NextResponse.json(result satisfies PriceResult, { status: 200 });
  }

  if (body.code === 4004) {
    return NextResponse.json(
      { ok: false, reason: "not_found" } satisfies PriceResult,
      { status: 200 }
    );
  }

  if (body.code === 4010) {
    return NextResponse.json(
      {
        ok: false,
        reason: "invalid_input",
        message: body.errors
          ? Object.entries(body.errors)
              .map(([f, m]) => `${f}: ${m.join(", ")}`)
              .join("; ")
          : "validation",
      } satisfies PriceResult,
      { status: 200 }
    );
  }

  return NextResponse.json(
    { ok: false, reason: "carrier_error", message: body.message ?? `code_${body.code}` } satisfies PriceResult,
    { status: 200 }
  );
}
