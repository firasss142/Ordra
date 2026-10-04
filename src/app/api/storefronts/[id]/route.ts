import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { getSyncState } from "@/lib/google-sheets/sync-state";
import { canManageStorefronts } from "@/lib/settings-permissions";
import { encrypt, maskCredential } from "@/lib/crypto";
import { getActor } from "@/lib/auth/actor";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

async function handleGET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  if (!canManageStorefronts(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("storefronts")
    .select("id, market_id, platform, name, config, is_active, created_at, updated_at")
    .eq("id", id)
    .single();

  if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (role !== "super_admin" && data.market_id !== actor.market_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({ data: { ...data, webhook_secret: maskCredential("") } });
}

async function handleDELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  if (!canManageStorefronts(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: existing } = await supabase
    .from("storefronts")
    .select("id, market_id")
    .eq("id", id)
    .single();

  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (role !== "super_admin" && existing.market_id !== actor.market_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ?hard=true → permanent delete, allowed ONLY when nothing references the
  // storefront. orders.storefront_id is NOT NULL with no cascade, so a referenced
  // storefront cannot be removed; we check first to return a clear 409 rather
  // than a raw FK error. storefront_product_mappings cascade, so they don't block.
  const hard = req.nextUrl.searchParams.get("hard") === "true";
  if (hard) {
    const { count } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("storefront_id", id);

    if ((count ?? 0) > 0) {
      return NextResponse.json(
        {
          error: `Suppression impossible : ${count} commande(s) référencent ce storefront. Archivez-le à la place.`,
        },
        { status: 409 },
      );
    }

    const { error: delError } = await supabase
      .from("storefronts")
      .delete()
      .eq("id", id);

    if (delError) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
    return new NextResponse(null, { status: 204 });
  }

  // Default: archive (soft-delete).
  const { error } = await supabase
    .from("storefronts")
    .update({ is_active: false })
    .eq("id", id);

  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  return new NextResponse(null, { status: 204 });
}

async function handlePATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  if (!canManageStorefronts(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Verify market ownership before mutating
  const { data: existing } = await supabase
    .from("storefronts")
    .select("id, market_id, platform")
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

  // A Sheets shop is created with its cursor already written (0 for "import
  // everything"). One without a cursor is a creation that broke halfway, and
  // switching it on would read the sheet from row 1: every order the account
  // ever took would land in the queue as new.
  if (body.is_active === true && existing.platform === "google_sheets") {
    const state = await getSyncState(createAdminClient(), existing.market_id);
    if (!state[id]) {
      return NextResponse.json(
        { error: "This sheet shop has no starting row; add it again instead", code: "cursor_missing" },
        { status: 409 },
      );
    }
  }

  const patch: Record<string, unknown> = {};
  // `platform` and `config` are fixed at creation. A new platform would run the
  // shop's orders through another adapter, and a new sheet would be read from
  // the old sheet's cursor — skipping or re-reading rows. Archive and add a new
  // shop instead; that is one click and keeps the history attributable.
  if (body.name !== undefined) patch.name = body.name;
  if (body.is_active !== undefined) patch.is_active = body.is_active;
  if (body.webhook_secret !== undefined)
    patch.webhook_secret = encrypt(String(body.webhook_secret));

  const { data, error } = await supabase
    .from("storefronts")
    .update(patch)
    .eq("id", id)
    .select("id, market_id, platform, name, config, is_active, updated_at")
    .single();

  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  return NextResponse.json({
    data: { ...data, webhook_secret: maskCredential("") },
  });
}

export const GET = withRouteErrors("/api/storefronts/[id]", "GET", handleGET);
export const PATCH = withRouteErrors("/api/storefronts/[id]", "PATCH", handlePATCH);
export const DELETE = withRouteErrors("/api/storefronts/[id]", "DELETE", handleDELETE);
