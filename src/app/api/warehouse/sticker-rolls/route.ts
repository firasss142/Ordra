import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";
import { resolveWarehouseScope } from "@/lib/warehouse/scope";
import { DARB_ZONES, normalizeHex } from "@/lib/carriers/darb-zones";

export const dynamic = "force-dynamic";

/**
 * The sticker rolls an account currently holds.
 *
 * Registering a roll is what ARMS the scan guard: with no open roll the bench
 * accepts any number, because refusing every scan on day one would strand the
 * warehouse. So this route is the on-switch, and it is deliberately strict
 * about what can be registered — a roll whose range is wrong would either
 * refuse good stickers or wave through foreign ones.
 *
 * Opening a roll is floor work, so `canScanWarehouse` gates it rather than a
 * manager-only permission: the person who takes the shrink-wrap off the roll is
 * the person who knows its first and last number.
 */

/** Live sticker numbers are 6–8 digits (708×7, 91×8, 62×6 across 861 orders). */
const MIN_STICKER = 100_000;
const MAX_STICKER = 999_999_999_999;
/** A roll is a roll: real blocks run ~100 (889188–889277). The schema caps this too. */
const MAX_ROLL_SPAN = 10_000;

const STATUSES = new Set(["open", "exhausted", "void"]);

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { marketId } = resolveWarehouseScope(req, actor);

  // The accounts a roll can belong to travel with the rolls: the registration
  // form needs both, and only a carrier that supplies its own stickers has any.
  const accountQuery = supabase
    .from("carriers")
    .select("id, name")
    .eq("supplies_own_labels", true)
    .eq("is_active", true);

  const [{ data, error }, { data: accounts }] = await Promise.all([
    supabase.rpc("get_sticker_rolls", { p_market_id: marketId }),
    (marketId ? accountQuery.eq("market_id", marketId) : accountQuery).order("name"),
  ]);

  if (error) {
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  return NextResponse.json({ rolls: data ?? [], accounts: accounts ?? [] });
}

export async function POST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    carrier_id?: string;
    color_hex?: string;
    range_start?: number;
    range_end?: number;
    label?: string;
    band_code?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const carrierId = body.carrier_id?.trim();
  if (!carrierId) {
    return NextResponse.json({ error: "Choisissez un transporteur" }, { status: 400 });
  }

  // The colour must be one Darb actually publishes. Anything else would create
  // a tenth zone that no destination can ever match.
  const colorHex = normalizeHex(body.color_hex);
  if (!DARB_ZONES[colorHex]) {
    return NextResponse.json({ error: "Couleur de rouleau inconnue" }, { status: 400 });
  }

  const start = Number(body.range_start);
  const end = Number(body.range_end);
  const wellFormed = (n: number) =>
    Number.isInteger(n) && n >= MIN_STICKER && n <= MAX_STICKER;

  if (!wellFormed(start) || !wellFormed(end)) {
    return NextResponse.json(
      { error: "Un numéro de sticker compte entre 6 et 12 chiffres" },
      { status: 400 },
    );
  }
  if (end < start) {
    return NextResponse.json(
      { error: "Le dernier numéro doit être supérieur au premier" },
      { status: 400 },
    );
  }
  if (end - start >= MAX_ROLL_SPAN) {
    return NextResponse.json(
      { error: `Plage trop large — un rouleau compte moins de ${MAX_ROLL_SPAN} stickers` },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.from("sticker_rolls").insert({
    carrier_id: carrierId,
    color_hex: colorHex,
    range_start: start,
    range_end: end,
    label: body.label?.trim() || null,
    band_code: body.band_code?.trim() || null,
    opened_by: actor.id,
  });

  if (error) {
    // The GiST exclusion constraint is the real authority on overlap; translate
    // it rather than leaking "conflicting key value violates…" to the floor.
    if (error.message.includes("sticker_rolls_no_overlap")) {
      return NextResponse.json(
        { error: "Cette plage chevauche un rouleau déjà enregistré" },
        { status: 409 },
      );
    }
    if (error.message.includes("sticker_rolls_range_sane")) {
      return NextResponse.json({ error: "Plage trop large pour un rouleau" }, { status: 400 });
    }
    // RLS refusal. It reached the floor as a bare "db_error" until a real form
    // submission hit it — the route tests mock Supabase and never meet RLS.
    if (error.message.includes("row-level security")) {
      return NextResponse.json(
        { error: "Vous ne pouvez pas enregistrer un rouleau pour ce transporteur" },
        { status: 403 },
      );
    }
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { id?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = body.id?.trim();
  const status = body.status?.trim();
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  if (!status || !STATUSES.has(status)) {
    return NextResponse.json({ error: "Statut de rouleau inconnu" }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("sticker_rolls")
    // Reopening clears the stamp: a roll that is open again was not closed.
    .update({ status, closed_at: status === "open" ? null : new Date().toISOString() })
    .eq("id", id);

  if (error) return NextResponse.json({ error: "db_error" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
