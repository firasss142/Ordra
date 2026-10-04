import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canManageReceptionPayments } from "@/lib/receptions/permissions";
import type { Role } from "@/types";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

const KINDS = ["freight", "customs", "clearing", "handling", "other"] as const;
const BASES = ["value", "units"] as const;

/**
 * Les frais d'approche d'une réception — ce qui a été payé pour que la
 * marchandise arrive ici.
 *
 * LE PRIX DU FOURNISSEUR N'EST PAS CE QUE LA MARCHANDISE COÛTE. Sans ces
 * lignes, tout COGS adopté depuis une réception est systématiquement trop bas,
 * ce qui gonfle la marge de chaque produit, le seuil de rentabilité et les
 * relevés investisseurs. C'est le plus gros écart de justesse du modèle pour un
 * importateur.
 *
 * Un frais est une information d'ARGENT : même porte que les paiements, donc
 * fermée à l'agent d'entrepôt — et la RLS de `reception_costs` le refuse aussi.
 *
 * MODIFIABLE TANT QUE RIEN N'EST ÉCRIT. Une fois la réception validée, le coût
 * de revient est figé dans `reception_lines.landed_unit_cost` et peut déjà avoir
 * nourri `unit_cogs` : rouvrir les frais après coup ferait mentir le registre.
 */

/**
 * Le type est écrit À LA MAIN, et c'est volontaire : laissé à l'inférence,
 * TypeScript fabrique une union dont `error` est optionnel, et le `return
 * g.error` des handlers passe alors pour « possiblement undefined ».
 */
type Guard =
  | { error: NextResponse; actor?: undefined; supabase?: undefined }
  | {
      error?: undefined;
      actor: { id: string; role: Role };
      supabase: Awaited<ReturnType<typeof createClient>>;
    };

async function guard(req: NextRequest, id: string): Promise<Guard> {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return { error: actorResult.response };
  const { actor } = actorResult;

  if (!canManageReceptionPayments(actor.role)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  const supabase = await createClient();
  const { data: reception, error } = await supabase
    .from("receptions")
    .select("id, status")
    .eq("id", id)
    .maybeSingle<{ id: string; status: string }>();

  if (error) return { error: NextResponse.json({ error: error.message }, { status: 500 }) };
  if (!reception) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  if (reception.status !== "draft" && reception.status !== "submitted") {
    return {
      error: NextResponse.json(
        {
          error: "Les frais d'une réception validée ne changent plus",
          error_code: "ALREADY_POSTED",
        },
        { status: 409 },
      ),
    };
  }

  return { actor, supabase };
}

async function handlePOST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const g = await guard(req, id);
  if (g.error) return g.error;

  let body: { amount?: number; kind?: string; label?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const amount = typeof body.amount === "number" ? body.amount : NaN;
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "Le montant doit être strictement positif" },
      { status: 400 },
    );
  }
  const kind = body.kind ?? "other";
  if (!KINDS.includes(kind as (typeof KINDS)[number])) {
    return NextResponse.json({ error: "Nature de frais inconnue" }, { status: 400 });
  }

  const { data, error } = await g.supabase
    .from("reception_costs")
    .insert({
      reception_id: id,
      kind,
      label: body.label?.trim() || null,
      amount,
      created_by: g.actor.id,
    })
    .select("id, kind, label, amount")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ cost: data }, { status: 201 });
}

/**
 * Changer le CRITÈRE de répartition.
 *
 * Une palette de livres et un carton de jouets ne partagent pas le transport de
 * la même façon : « par valeur » est le choix courant, « par unité » existe pour
 * le fret au volume. C'est un choix, jamais un défaut silencieux.
 */
async function handlePATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const g = await guard(req, id);
  if (g.error) return g.error;

  let body: { fee_basis?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!BASES.includes(body.fee_basis as (typeof BASES)[number])) {
    return NextResponse.json({ error: "Critère de répartition inconnu" }, { status: 400 });
  }

  const { error } = await g.supabase
    .from("receptions")
    .update({ fee_basis: body.fee_basis })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, fee_basis: body.fee_basis });
}

async function handleDELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const g = await guard(req, id);
  if (g.error) return g.error;

  const costId = req.nextUrl.searchParams.get("cost_id");
  if (!costId) {
    return NextResponse.json({ error: "cost_id is required" }, { status: 400 });
  }

  const { error } = await g.supabase
    .from("reception_costs")
    .delete()
    .eq("id", costId)
    .eq("reception_id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

/*
 * Chaque gestionnaire passe par `withRouteErrors`, sinon ses 500 n'arrivent
 * jamais dans Journaux › « Ordra — erreurs et sécurité ». Un test du dépôt
 * (`routes-are-wrapped`) refuse toute route qui exporte un gestionnaire nu.
 */
export const POST = withRouteErrors("/api/warehouse/receptions/[id]/costs", "POST", handlePOST);
export const PATCH = withRouteErrors("/api/warehouse/receptions/[id]/costs", "PATCH", handlePATCH);
export const DELETE = withRouteErrors("/api/warehouse/receptions/[id]/costs", "DELETE", handleDELETE);
