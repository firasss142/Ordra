import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canManageCarriers } from "@/lib/settings-permissions";
import { checkSiteDeactivation } from "@/lib/warehouse/site-deactivation";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * Les sites physiques d'un marché, côté administration.
 *
 * Distinct de /api/warehouse/sites, qui sert les écrans d'entrepôt et ne montre
 * que les sites ACTIFS. Ici on montre aussi les sites désactivés — sans quoi on
 * ne pourrait jamais en rallumer un — avec de quoi mesurer l'impact d'une
 * désactivation : qui y est affecté, et ce qu'il y reste en stock.
 *
 * Lecture : super_admin (tout marché) ou market_manager (son marché, en
 * lecture seule dans Réglages › Entrepôts). Écriture : super_admin uniquement.
 */

export interface AdminWarehouseSite {
  id: string;
  code: string;
  nameFr: string;
  nameAr: string;
  marketId: string;
  isDefault: boolean;
  isActive: boolean;
  /** Les warehouse_agents épinglés sur ce site. */
  assignedAgents: Array<{ id: string; name: string }>;
  /** Unités encore ventilées sur ce site. */
  stockUnits: number;
}

async function handleGET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  const isManager = actor.role === "market_manager" && !!actor.market_id;
  if (!canManageCarriers(actor.role) && !isManager) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  // A manager only ever sees their own market, whatever they ask for.
  const marketId = isManager ? actor.market_id : req.nextUrl.searchParams.get("market_id");

  let query = supabase
    .from("warehouses")
    .select("id, code, name_fr, name_ar, market_id, is_default, is_active")
    .order("is_default", { ascending: false })
    .order("code", { ascending: true });
  if (marketId) query = query.eq("market_id", marketId);

  const { data: sites, error } = await query;
  if (error) {
    console.error("[GET /api/admin/warehouse-sites] read failed", {
      code: error.code,
      message: error.message,
    });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  const rows = (sites ?? []) as Array<{
    id: string;
    code: string;
    name_fr: string;
    name_ar: string;
    market_id: string;
    is_default: boolean;
    is_active: boolean;
  }>;
  const siteIds = rows.map((r) => r.id);

  // Les deux mesures d'impact, en deux requêtes groupées plutôt qu'en N+1.
  const [agentsRes, stockRes] = await Promise.all([
    siteIds.length
      ? supabase
          .from("users")
          .select("id, full_name, warehouse_id")
          .in("warehouse_id", siteIds)
          .is("deleted_at", null)
      : Promise.resolve({ data: [], error: null }),
    siteIds.length
      ? supabase
          .from("product_site_stock")
          .select("warehouse_id, current_stock")
          .in("warehouse_id", siteIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const agentsBySite = new Map<string, Array<{ id: string; name: string }>>();
  for (const u of (agentsRes.data ?? []) as Array<{
    id: string;
    full_name: string | null;
    warehouse_id: string | null;
  }>) {
    if (!u.warehouse_id) continue;
    const list = agentsBySite.get(u.warehouse_id) ?? [];
    list.push({ id: u.id, name: u.full_name ?? "—" });
    agentsBySite.set(u.warehouse_id, list);
  }

  const stockBySite = new Map<string, number>();
  for (const s of (stockRes.data ?? []) as Array<{
    warehouse_id: string;
    current_stock: number | null;
  }>) {
    stockBySite.set(
      s.warehouse_id,
      (stockBySite.get(s.warehouse_id) ?? 0) + (s.current_stock ?? 0),
    );
  }

  const data: AdminWarehouseSite[] = rows.map((r) => ({
    id: r.id,
    code: r.code,
    nameFr: r.name_fr,
    nameAr: r.name_ar,
    marketId: r.market_id,
    isDefault: r.is_default,
    isActive: r.is_active,
    assignedAgents: agentsBySite.get(r.id) ?? [],
    stockUnits: stockBySite.get(r.id) ?? 0,
  }));

  return NextResponse.json({ data });
}

/**
 * Activer ou désactiver un site.
 *
 * Une désactivation qui laisse des agents ou du stock derrière elle renvoie 409
 * avec le détail, tant que l'appelant n'a pas confirmé. Réactiver ne demande
 * jamais rien : c'est le sens sûr.
 */
async function handlePATCH(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canManageCarriers(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id : "";
  const isActive = body.is_active;
  const confirmed = body.confirmed === true;

  if (!id || typeof isActive !== "boolean") {
    return NextResponse.json(
      { error: "id et is_active (booléen) requis" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data: site } = await supabase
    .from("warehouses")
    .select("id, is_default, is_active")
    .eq("id", id)
    .single();

  if (!site) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!isActive) {
    const [agentsRes, stockRes] = await Promise.all([
      supabase.from("users").select("id, full_name").eq("warehouse_id", id).is("deleted_at", null),
      supabase.from("product_site_stock").select("current_stock").eq("warehouse_id", id),
    ]);

    const assignedAgents = (
      (agentsRes.data ?? []) as Array<{ id: string; full_name: string | null }>
    ).map((u) => ({ id: u.id, name: u.full_name ?? "—" }));
    const stockUnits = (
      (stockRes.data ?? []) as Array<{ current_stock: number | null }>
    ).reduce((sum, r) => sum + (r.current_stock ?? 0), 0);

    const verdict = checkSiteDeactivation({
      site: {
        id: site.id as string,
        isDefault: site.is_default as boolean,
        isActive: site.is_active as boolean,
      },
      assignedAgents,
      stockUnits,
      confirmed,
    });

    if (!verdict.ok) {
      return NextResponse.json(
        {
          error: verdict.message,
          code: verdict.code,
          ...(verdict.code === "needs_confirmation"
            ? { agents: verdict.agents, stockUnits: verdict.stockUnits }
            : {}),
        },
        { status: 409 },
      );
    }
  }

  const { error } = await supabase
    .from("warehouses")
    .update({ is_active: isActive })
    .eq("id", id);

  if (error) {
    console.error("[PATCH /api/admin/warehouse-sites] update failed", {
      code: error.code,
      message: error.message,
    });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  return NextResponse.json({ data: { id, is_active: isActive } });
}

export const GET = withRouteErrors("/api/admin/warehouse-sites", "GET", handleGET);
export const PATCH = withRouteErrors("/api/admin/warehouse-sites", "PATCH", handlePATCH);
