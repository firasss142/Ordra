import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

const VALID_LANGUAGES = new Set(["fr", "ar"]);

/**
 * PATCH /api/markets/[id] — edit a market (super_admin only).
 *
 * Editable: name, language, is_active. currency and code are intentionally
 * NOT editable — changing currency would misread thousands of historical
 * orders, and code is the isolation key wired into RLS and hardcoded IDs.
 * A market is edit-only (no create/delete) because both are constrained by
 * the `code IN ('tn','ly')` CHECK and would need a migration.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  if (actorResult.actor.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) {
    patch.name = body.name.trim();
  }
  if (body.language !== undefined) {
    if (typeof body.language !== "string" || !VALID_LANGUAGES.has(body.language)) {
      return NextResponse.json({ error: "Langue invalide" }, { status: 400 });
    }
    patch.language = body.language;
    // direction follows language: Arabic is RTL, French LTR.
    patch.direction = body.language === "ar" ? "rtl" : "ltr";
  }
  if (typeof body.is_active === "boolean") {
    patch.is_active = body.is_active;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: "Aucun champ modifiable fourni (nom, langue ou statut actif)." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("markets")
    .update(patch)
    .eq("id", id)
    .select("id, code, name, language, currency, direction, is_active")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  revalidateTag("markets");
  return NextResponse.json({ data });
}
