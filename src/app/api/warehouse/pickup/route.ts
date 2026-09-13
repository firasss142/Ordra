import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";
import { resolveWarehouseScope } from "@/lib/warehouse/scope";
import { resolveSiteFilter } from "@/lib/warehouse/site-scope";
import {
  pickupSettingKey,
  isPickupDisabledNow,
  canTogglePickup,
  readDisabledAt,
  PICKUP_KEY_PREFIX,
} from "@/lib/carriers/pickup-window";

export const dynamic = "force-dynamic";

/**
 * "Le chauffeur est passé" — the per-site pickup switch.
 *
 * GET  → the state of every site in the market, for today.
 * POST → move one site's switch ({ warehouse_id, disabled: boolean }).
 *
 * The state is derived, never stored as a boolean: the row holds the INSTANT of
 * the press, and a press from any earlier local day simply is not today. That
 * is what puts `isPickup` back to its `true` default at midnight with no cron.
 */

/** Which Darb account ships from which site — the modal knows only its carrier. */
export interface PickupCarrierLink {
  carrierId: string;
  warehouseId: string;
}

export interface PickupSiteState {
  warehouseId: string;
  code: string;
  name: string;
  /** True when pickup is switched OFF for this site today. */
  disabled: boolean;
  /** When it was switched off, if it is. */
  disabledAt: string | null;
  /** May the caller switch this site OFF right now? */
  canDisable: boolean;
  /** May the caller turn it back ON before midnight? */
  canEnable: boolean;
}

async function loadState(
  req: NextRequest,
  actor: { id: string; role: string; market_id: string | null },
): Promise<
  | { response: NextResponse }
  | {
      sites: PickupSiteState[];
      marketId: string | null;
      carriers: PickupCarrierLink[];
    }
> {
  const supabase = await createClient();
  const { marketId } = resolveWarehouseScope(req, actor);
  const site = await resolveSiteFilter(supabase, { actor, requested: null });

  let query = supabase
    .from("warehouses")
    .select("id, code, name_fr, name_ar, is_default")
    .eq("is_active", true)
    .order("is_default", { ascending: false })
    .order("code", { ascending: true });
  if (marketId) query = query.eq("market_id", marketId);

  const { data: warehouseRows, error } = await query;
  if (error) {
    return { response: NextResponse.json({ error: "db_error" }, { status: 500 }) };
  }

  const rows = (warehouseRows ?? []) as Array<{
    id: string;
    code: string;
    name_fr: string;
    name_ar: string;
  }>;

  // One read for every site's switch rather than a query per building.
  const { data: settingRows } = await supabase
    .from("settings")
    .select("key, value")
    .eq("market_id", marketId ?? "")
    .like("key", `${PICKUP_KEY_PREFIX}%`);

  const byKey = new Map(
    ((settingRows ?? []) as Array<{ key: string; value: unknown }>).map((r) => [
      r.key,
      r.value,
    ]),
  );

  const marketCode = marketId ? resolveWarehouseScope(req, actor).marketCode : null;
  const now = new Date();

  const sites: PickupSiteState[] = rows
    // A warehouse agent sees only their own building; an unassigned one sees
    // none, exactly as the bench does.
    .filter((r) => (site.pinned ? r.id === site.warehouseId : true))
    .map((r) => {
      const raw = byKey.get(pickupSettingKey(r.id));
      const disabled = isPickupDisabledNow(raw, marketId, now);
      const at = disabled ? readDisabledAt(raw) : null;
      return {
        warehouseId: r.id,
        code: r.code,
        // The site name is a place name painted on the building, not a key.
        name: marketCode === "ly" ? r.name_ar : r.name_fr,
        disabled,
        disabledAt: at ? at.toISOString() : null,
        canDisable:
          !disabled &&
          canTogglePickup({
            role: actor.role,
            actorSiteId: site.warehouseId,
            targetSiteId: r.id,
            turningOff: true,
          }),
        canEnable:
          disabled &&
          canTogglePickup({
            role: actor.role,
            actorSiteId: site.warehouseId,
            targetSiteId: r.id,
            turningOff: false,
          }),
      };
    });

  // The dispatch modal holds a carrier id and needs the site behind it. One
  // small join here beats every caller re-deriving it.
  let carriers: PickupCarrierLink[] = [];
  if (marketId) {
    const { data: carrierRows } = await supabase
      .from("carriers")
      .select("id, warehouse_id")
      .eq("market_id", marketId)
      .eq("code", "darb_assabil");
    carriers = ((carrierRows ?? []) as Array<{ id: string; warehouse_id: string | null }>)
      .filter((c): c is { id: string; warehouse_id: string } => Boolean(c.warehouse_id))
      .map((c) => ({ carrierId: c.id, warehouseId: c.warehouse_id }));
  }

  return { sites, marketId, carriers };
}

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const state = await loadState(req, actor);
  if ("response" in state) return state.response;

  return NextResponse.json({ sites: state.sites, carriers: state.carriers });
}

export async function POST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { warehouse_id?: unknown; disabled?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const warehouseId = typeof body.warehouse_id === "string" ? body.warehouse_id : "";
  const disabled = body.disabled;
  if (!warehouseId || typeof disabled !== "boolean") {
    return NextResponse.json(
      { error: "warehouse_id and disabled are required" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { marketId } = resolveWarehouseScope(req, actor);
  if (!marketId) {
    // "Tous les marchés" is not a place a driver visits.
    return NextResponse.json({ error: "market_required" }, { status: 400 });
  }

  // The site must exist, be active, and belong to the caller's market — the
  // same three checks the site assignment does. A Libyan switch must not be
  // reachable from a Tunisian session.
  const { data: warehouse } = await supabase
    .from("warehouses")
    .select("id, market_id, is_active")
    .eq("id", warehouseId)
    .maybeSingle<{ id: string; market_id: string; is_active: boolean }>();

  if (!warehouse || !warehouse.is_active || warehouse.market_id !== marketId) {
    return NextResponse.json({ error: "unknown_site" }, { status: 404 });
  }

  const site = await resolveSiteFilter(supabase, { actor, requested: null });
  if (
    !canTogglePickup({
      role: actor.role,
      actorSiteId: site.warehouseId,
      targetSiteId: warehouseId,
      turningOff: disabled,
    })
  ) {
    return NextResponse.json(
      {
        error: disabled ? "forbidden_site" : "manager_required",
      },
      { status: 403 },
    );
  }

  // `settings` is written with the service role: a warehouse agent has no write
  // policy on it, and must not be given one for a whole settings table just to
  // press this. Authorisation is decided above, in code, not by RLS here.
  const admin = createAdminClient();
  const key = pickupSettingKey(warehouseId);

  const value = disabled
    ? { disabled_at: new Date().toISOString(), by: actor.id }
    // Turning it back on erases the stamp rather than writing "false": the
    // absence of a press IS the default, and there is then one shape to read.
    : {};

  const { error } = await admin.from("settings").upsert(
    {
      market_id: marketId,
      key,
      value,
      updated_by: actor.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "market_id,key" },
  );

  if (error) {
    console.error("[POST /api/warehouse/pickup] upsert failed", {
      warehouseId,
      code: error.code,
      message: error.message,
    });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  const state = await loadState(req, actor);
  if ("response" in state) return state.response;
  return NextResponse.json({ sites: state.sites, carriers: state.carriers });
}
