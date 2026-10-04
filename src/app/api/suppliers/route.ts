import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewSuppliers, canManageSuppliers } from "@/lib/purchases/permissions";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * Les fournisseurs d'un marché.
 *
 * LE MARCHÉ VIENT DE L'ACTEUR, JAMAIS DU CORPS DE LA REQUÊTE. Un `market_id`
 * accepté depuis le client laisserait un manager écrire dans l'autre marché —
 * la RLS le refuserait, mais une route ne doit pas s'appuyer sur la base pour
 * dire non. Seul un super_admin nomme un marché, parce qu'il n'en a pas (les
 * deux comptes de production ont `market_id` NULL).
 */

function resolveMarket(req: NextRequest, role: string, actorMarket: string | null): string | null {
  return role === "super_admin" ? req.nextUrl.searchParams.get("market_id") : actorMarket;
}

async function handleGET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canViewSuppliers(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const marketId = resolveMarket(req, actor.role, actor.market_id);
  if (!marketId) {
    return NextResponse.json({ error: "market_id query parameter required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("suppliers")
    .select("id, name, category, city, phone, note, is_active")
    .eq("market_id", marketId)
    .order("name");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ suppliers: data ?? [] });
}

async function handlePOST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canManageSuppliers(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const marketId =
    actor.role === "super_admin"
      ? (body.market_id as string | undefined) ?? req.nextUrl.searchParams.get("market_id")
      : actor.market_id;
  if (!marketId) {
    return NextResponse.json({ error: "market_id required" }, { status: 400 });
  }

  // Le doublon qu'on crée vraiment est « Biovera » / « biovera  » : on rogne
  // avant d'écrire, et l'index unique insensible à la casse ferme le reste.
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "NAME_REQUIRED" }, { status: 400 });
  }

  const optional = (k: string) => {
    const v = body[k];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("suppliers")
    .insert({
      market_id: marketId,
      name,
      category: optional("category"),
      city: optional("city"),
      phone: optional("phone"),
      note: optional("note"),
      created_by: actor.id,
    })
    .select("id, name, category, city, phone, note, is_active")
    .single();

  if (error) {
    // 23505 = l'index unique (market_id, lower(btrim(name))). C'est une
    // collision prévisible, pas une panne : l'écran doit pouvoir le dire.
    if (error.code === "23505") {
      return NextResponse.json({ error: "DUPLICATE_NAME" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ supplier: data }, { status: 201 });
}

/*
 * Chaque gestionnaire passe par `withRouteErrors`, sinon ses 500 n'arrivent
 * jamais dans Journaux › « Ordra — erreurs et sécurité ». Un test du dépôt
 * (`routes-are-wrapped`) refuse toute route qui exporte un gestionnaire nu.
 */
export const GET = withRouteErrors("/api/suppliers", "GET", handleGET);
export const POST = withRouteErrors("/api/suppliers", "POST", handlePOST);
