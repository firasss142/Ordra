import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { decrypt } from "@/lib/crypto";

export const dynamic = "force-dynamic";

/**
 * Read a single value out of a carrier's encrypted credentials blob.
 * Returns null if the blob is absent, unparseable, or the key is missing —
 * callers fall back to their own default.
 */
function readCredentialKey(
  ciphertext: string | null | undefined,
  key: string,
): string | null {
  if (!ciphertext) return null;
  try {
    const parsed = JSON.parse(decrypt(ciphertext));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const v = (parsed as Record<string, unknown>)[key];
      return typeof v === "string" ? v : null;
    }
  } catch {
    // legacy/corrupt blob — treat as absent
  }
  return null;
}

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  const code = req.nextUrl.searchParams.get("code");
  const marketId = req.nextUrl.searchParams.get("market_id");
  const carrierId = req.nextUrl.searchParams.get("carrier_id");
  if (!code || !marketId) {
    return NextResponse.json(
      { error: "Missing code or market_id" },
      { status: 400 },
    );
  }

  // Market gate: non-super_admins can only ask about their own market
  if (actor.role !== "super_admin" && actor.market_id !== marketId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // A market can hold SEVERAL rows under one code — Libya runs two Darb Assabil
  // accounts (Tripoli + Benghazi), since 20260816000003 relaxed the uniqueness
  // key to (market_id, code, name). .maybeSingle() throws on multiple rows, so
  // this takes the first deterministically and lets a caller that knows which
  // account it means disambiguate with ?carrier_id=.
  const supabase = await createClient();
  let query = supabase
    .from("carriers")
    .select("id, delivery_fee, is_active")
    .eq("code", code)
    .eq("market_id", marketId);
  if (carrierId) query = query.eq("id", carrierId);

  const { data: carriers, error } = await query.order("id", { ascending: true }).limit(1);

  if (error) {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  const carrier = carriers?.[0];
  if (!carrier) {
    return NextResponse.json({ carrier: null });
  }

  // cost_type lives in the encrypted credentials blob, which is REVOKE'd from
  // the authenticated role — read it via the admin client. "1" (customer pays
  // delivery) is the default when unset, matching the payload builder.
  const admin = createAdminClient();
  const { data: credRow } = await admin
    .from("carriers")
    .select("api_credentials")
    .eq("id", carrier.id)
    .maybeSingle();
  const costType = readCredentialKey(credRow?.api_credentials, "cost_type") ?? "1";

  return NextResponse.json({
    carrier: { ...carrier, cost_type: costType },
  });
}
