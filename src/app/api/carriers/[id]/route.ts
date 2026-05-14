import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { canManageCarriers } from "@/lib/settings-permissions";
import { encrypt, decrypt, maskCredential } from "@/lib/crypto";
import { getActor } from "@/lib/auth/actor";
import { getAdapterDescriptor } from "@/lib/carriers/adapter-registry";

export const dynamic = "force-dynamic";

/**
 * Decrypt an existing credentials blob into a plain object.
 * Returns {} if absent or unparseable — a partial update should still go
 * through rather than fail on a legacy/corrupt blob.
 */
function decodeExistingCredentials(
  ciphertext: string | null | undefined
): Record<string, string> {
  if (!ciphertext) return {};
  try {
    const parsed = JSON.parse(decrypt(ciphertext));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    // legacy plain-string blob or bad data — treat as empty base
  }
  return {};
}

/**
 * Build the credentials blob to persist on PATCH.
 * The incoming `credentials` object is PARTIAL — only the fields the form
 * actually filled — so it is merged over the existing decrypted credentials
 * rather than replacing them. This keeps untouched secrets and non-secret
 * fields intact when the user edits just one field (e.g. a cost_type toggle).
 *
 * Returns:
 *   undefined → caller didn't try to set credentials; leave field untouched.
 *   null      → caller cleared credentials.
 *   string    → encrypted JSON to store.
 */
function encodeCredentials(
  carrierCode: string,
  body: Record<string, unknown>,
  existingCiphertext: string | null | undefined
): string | null | undefined {
  const credsObj = body.credentials;
  if (credsObj && typeof credsObj === "object" && !Array.isArray(credsObj)) {
    const incoming: Record<string, string> = {};
    for (const [k, v] of Object.entries(credsObj as Record<string, unknown>)) {
      if (v !== undefined && v !== null && String(v).length > 0) {
        incoming[k] = String(v);
      }
    }
    if (Object.keys(incoming).length === 0) return undefined;
    const merged = { ...decodeExistingCredentials(existingCiphertext), ...incoming };
    return encrypt(JSON.stringify(merged));
  }

  if (body.api_key === undefined) return undefined;
  const apiKey = body.api_key;
  if (apiKey === null || String(apiKey).length === 0) return null;

  const descriptor = getAdapterDescriptor(carrierCode);
  const secretKey = descriptor?.credentialFields.find((f) => f.secret)?.key;
  if (!secretKey) return encrypt(String(apiKey));
  const merged = {
    ...decodeExistingCredentials(existingCiphertext),
    [secretKey]: String(apiKey),
  };
  return encrypt(JSON.stringify(merged));
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

  // Fetch + decrypt credentials via the admin client (api_credentials is
  // REVOKE'd from the authenticated role). Only NON-SECRET fields are
  // returned so the edit form can prefill them — secrets never leave the
  // server and stay masked / rotate-only in the UI.
  const admin = createAdminClient();
  const { data: credRow } = await admin
    .from("carriers")
    .select("api_credentials")
    .eq("id", id)
    .single();

  const allCredentials = decodeExistingCredentials(credRow?.api_credentials);
  const descriptor = getAdapterDescriptor(String(data.code));
  const secretKeys = new Set(
    (descriptor?.credentialFields ?? [])
      .filter((f) => f.secret)
      .map((f) => f.key)
  );
  const credentials: Record<string, string> = {};
  for (const [k, v] of Object.entries(allCredentials)) {
    if (!secretKeys.has(k)) credentials[k] = v;
  }

  return NextResponse.json({
    data: { ...data, api_credentials: maskCredential(""), credentials },
  });
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

  // Verify market ownership before mutating.
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

  // Admin client: api_endpoint and api_credentials are REVOKE'd from authenticated role.
  const admin = createAdminClient();

  // Only when credentials are being touched: fetch the existing (encrypted)
  // blob via the admin client so a partial update can be merged over it.
  const updatingCredentials =
    body.credentials !== undefined || body.api_key !== undefined;
  let existingCredentials: string | null = null;
  if (updatingCredentials) {
    const { data: credRow } = await admin
      .from("carriers")
      .select("api_credentials")
      .eq("id", id)
      .single();
    existingCredentials = credRow?.api_credentials ?? null;
  }

  const credentialsUpdate = encodeCredentials(
    String(existing.code),
    body,
    existingCredentials
  );
  if (credentialsUpdate !== undefined) {
    patch.api_credentials = credentialsUpdate;
  }

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
