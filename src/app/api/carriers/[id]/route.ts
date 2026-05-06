import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { canManageCarriers } from "@/lib/settings-permissions";
import { encrypt, maskCredential } from "@/lib/crypto";
import { getActor } from "@/lib/auth/actor";
import { getAdapterDescriptor } from "@/lib/carriers/adapter-registry";

function encodeCredentials(
  carrierCode: string,
  body: Record<string, unknown>
): string | null | undefined {
  // undefined → caller didn't try to set credentials; leave field untouched.
  // null      → caller cleared credentials.
  // string    → encrypted JSON to store.
  const credsObj = body.credentials;
  if (credsObj && typeof credsObj === "object" && !Array.isArray(credsObj)) {
    const flat: Record<string, string> = {};
    for (const [k, v] of Object.entries(credsObj as Record<string, unknown>)) {
      if (v !== undefined && v !== null && String(v).length > 0) {
        flat[k] = String(v);
      }
    }
    return Object.keys(flat).length === 0 ? null : encrypt(JSON.stringify(flat));
  }

  if (body.api_key === undefined) return undefined;
  const apiKey = body.api_key;
  if (apiKey === null || String(apiKey).length === 0) return null;

  const descriptor = getAdapterDescriptor(carrierCode);
  const secretKey = descriptor?.credentialFields.find((f) => f.secret)?.key;
  if (!secretKey) return encrypt(String(apiKey));
  return encrypt(JSON.stringify({ [secretKey]: String(apiKey) }));
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  if (!canManageCarriers(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("carriers")
    .select("id, market_id, name, code, api_endpoint, delivery_fee, return_fee, is_active, created_at, updated_at")
    .eq("id", id)
    .single();

  if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (role !== "super_admin" && data.market_id !== actor.market_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({ data: { ...data, api_credentials: maskCredential("") } });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  if (!canManageCarriers(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: existing } = await supabase
    .from("carriers")
    .select("id, market_id")
    .eq("id", id)
    .single();

  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (role !== "super_admin" && existing.market_id !== actor.market_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Soft-delete
  const { error } = await supabase
    .from("carriers")
    .update({ is_active: false })
    .eq("id", id);

  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  return new NextResponse(null, { status: 204 });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  if (!canManageCarriers(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Verify market ownership before mutating
  const { data: existing } = await supabase
    .from("carriers")
    .select("id, market_id, code")
    .eq("id", id)
    .single();

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (role !== "super_admin" && existing.market_id !== actor.market_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.api_endpoint !== undefined) patch.api_endpoint = body.api_endpoint;
  if (body.delivery_fee !== undefined) patch.delivery_fee = body.delivery_fee;
  if (body.return_fee !== undefined) patch.return_fee = body.return_fee;
  if (body.is_active !== undefined) patch.is_active = body.is_active;

  const credentialsUpdate = encodeCredentials(String(existing.code), body);
  if (credentialsUpdate !== undefined) {
    patch.api_credentials = credentialsUpdate;
  }

  // Admin client: api_endpoint and api_credentials are REVOKE'd from authenticated role.
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("carriers")
    .update(patch)
    .eq("id", id)
    .select("id, market_id, name, code, api_endpoint, delivery_fee, return_fee, is_active, updated_at")
    .single();

  if (error) {
    console.error("[PATCH /api/carriers/[id]] update failed", { code: error.code, message: error.message, details: error.details });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({
    data: { ...data, api_credentials: maskCredential("") },
  });
}
