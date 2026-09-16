import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canManageCarriers } from "@/lib/settings-permissions";
import { getActor } from "@/lib/auth/actor";
import {
  ORDER_OPTION_KEYS,
  resolveOrderPreferences,
  resolveFulfilmentModes,
  isFulfilmentModeChangeValid,
  type CarrierOrderPreferenceRow,
  type OrderOptionKey,
} from "@/lib/carriers/order-preferences";

export const dynamic = "force-dynamic";

const KEY_SET = new Set<string>(ORDER_OPTION_KEYS);

/**
 * Charge le transporteur pour vérifier qu'il existe et à quel marché il
 * appartient. La lecture est ouverte au marché ; l'écriture ne l'est pas.
 */
async function loadCarrier(id: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("carriers")
    .select("id, market_id")
    .eq("id", id)
    .single();
  return data as { id: string; market_id: string } | null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  const carrier = await loadCarrier(id);
  if (!carrier) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Lecture : super_admin partout, sinon son propre marché. Le modal de
  // dispatch appelle ceci pour un agent, donc on ne peut pas la réserver.
  if (actor.role !== "super_admin" && carrier.market_id !== actor.market_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("carrier_order_preferences")
    .select("carrier_id, option_key, default_value, can_override")
    .eq("carrier_id", id);

  if (error) {
    console.error("[GET /api/carriers/[id]/order-preferences] read failed", {
      code: error.code,
      message: error.message,
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const rows = (data ?? []) as CarrierOrderPreferenceRow[];

  return NextResponse.json({
    data: resolveOrderPreferences(rows, id),
    fulfilmentModes: resolveFulfilmentModes(rows, id),
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  // Écriture : super_admin uniquement — décision du 2026-09-16. Le contrôle est
  // aussi dans la RLS ; ici pour un 403 propre plutôt qu'un 500.
  if (!canManageCarriers(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const carrier = await loadCarrier(id);
  if (!carrier) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const incoming = body.preferences;
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    return NextResponse.json({ error: "preferences manquant" }, { status: 400 });
  }

  // Les deux modes d'expédition, optionnels : un appel qui ne touche qu'aux
  // options n'a pas à les envoyer.
  const modesRaw = body.fulfilmentModes;
  let modeRows: Array<{
    carrier_id: string;
    option_key: string;
    default_value: boolean;
    can_override: boolean;
  }> = [];

  if (modesRaw !== undefined) {
    if (!modesRaw || typeof modesRaw !== "object" || Array.isArray(modesRaw)) {
      return NextResponse.json(
        { error: "fulfilmentModes invalide" },
        { status: 400 },
      );
    }
    const { home, carrier } = modesRaw as Record<string, unknown>;
    if (typeof home !== "boolean" || typeof carrier !== "boolean") {
      return NextResponse.json(
        { error: "fulfilmentModes — booléens attendus" },
        { status: 400 },
      );
    }
    // Les deux éteints laisseraient le transporteur sans aucun endroit d'où
    // expédier. Refusé ici plutôt que découvert au moment d'envoyer.
    if (!isFulfilmentModeChangeValid({ home, carrier })) {
      return NextResponse.json(
        {
          error:
            "Au moins un mode d'expédition doit rester actif — sinon ce transporteur n'a plus aucun entrepôt d'où partir.",
        },
        { status: 400 },
      );
    }
    modeRows = [
      { carrier_id: id, option_key: "mode_home_warehouse", default_value: home, can_override: true },
      { carrier_id: id, option_key: "mode_carrier_warehouse", default_value: carrier, can_override: true },
    ];
  }

  // Valider TOUT avant d'écrire quoi que ce soit : une clé inconnue ou une
  // valeur non booléenne annule l'ensemble, plutôt que d'écrire à moitié.
  const rows: Array<{
    carrier_id: string;
    option_key: OrderOptionKey;
    default_value: boolean;
    can_override: boolean;
  }> = [];

  for (const [key, raw] of Object.entries(incoming as Record<string, unknown>)) {
    if (!KEY_SET.has(key)) {
      return NextResponse.json(
        { error: `Option inconnue : ${key}` },
        { status: 400 },
      );
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return NextResponse.json(
        { error: `Valeur invalide pour ${key}` },
        { status: 400 },
      );
    }
    const { value, canOverride } = raw as Record<string, unknown>;
    if (typeof value !== "boolean" || typeof canOverride !== "boolean") {
      return NextResponse.json(
        { error: `Valeur invalide pour ${key} — booléens attendus` },
        { status: 400 },
      );
    }
    rows.push({
      carrier_id: id,
      option_key: key as OrderOptionKey,
      default_value: value,
      can_override: canOverride,
    });
  }

  const allRows = [...rows, ...modeRows];
  if (allRows.length === 0) {
    return NextResponse.json({ error: "Aucune option fournie" }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("carrier_order_preferences")
    .upsert(allRows, { onConflict: "carrier_id,option_key" });

  if (error) {
    console.error("[PUT /api/carriers/[id]/order-preferences] write failed", {
      code: error.code,
      message: error.message,
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data: { updated: allRows.length } });
}
