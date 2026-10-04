import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { uploadLogoDataUrl, type LogoOwner } from "@/lib/logos";
import type { Role } from "@/types";

/**
 * PUT `{ logo: dataUrl | null }` on one storefront or carrier row: a data URL
 * replaces the logo, `null` removes it (the screen falls back to the platform
 * or carrier mark). Both tables are super_admin-only to write, like every
 * other field of theirs, and the market check mirrors their PATCH routes.
 */
export function makeLogoPUT(opts: {
  owner: LogoOwner;
  table: "storefronts" | "carriers";
  canManage: (role: Role) => boolean;
}) {
  return async function handlePUT(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) {
    const { id } = await params;

    const actorResult = await getActor(req);
    if ("response" in actorResult) return actorResult.response;
    const { actor } = actorResult;
    if (!opts.canManage(actor.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    // An absent key is a client bug, not a request to remove the logo.
    if (!("logo" in body) || (body.logo !== null && typeof body.logo !== "string")) {
      return NextResponse.json({ error: "logo must be a data URL or null" }, { status: 400 });
    }

    // Service client, like the avatar route: who may write was decided above,
    // and this does not depend on each table's RLS write policy.
    const supabase = createAdminClient({ actorId: actor.id });
    const { data: existing } = await supabase
      .from(opts.table)
      .select("id, market_id")
      .eq("id", id)
      .single();
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (actor.role !== "super_admin" && existing.market_id !== actor.market_id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let logoUrl: string | null = null;
    if (typeof body.logo === "string") {
      const upload = await uploadLogoDataUrl(opts.owner, id, body.logo);
      if (!upload.ok) return NextResponse.json({ error: upload.error }, { status: upload.status });
      logoUrl = upload.url;
    }

    const { error } = await supabase
      .from(opts.table)
      .update({ logo_url: logoUrl })
      .eq("id", id)
      .select("id, logo_url")
      .single();
    if (error) {
      console.error(`[PUT /api/${opts.table}/[id]/logo] update error:`, error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    return NextResponse.json({ logo_url: logoUrl });
  };
}
