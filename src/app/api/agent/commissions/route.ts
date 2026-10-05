import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewOwnCommissions } from "@/lib/role-permissions";
import type { AgentStatement } from "@/lib/commissions/types";
import { withRouteErrors } from "@/lib/journal/route-errors";
import { likelyPerParcel } from "@/lib/calculations/commission-likely";

export const dynamic = "force-dynamic";

/**
 * GET /api/agent/commissions?days=90 — "Mes commissions".
 * No agent parameter exists, by design: get_my_commission_statement() reads auth.uid().
 * `days` bounds the lists that grow forever (paid orders, not counted); totals are all-time.
 */
async function handleGET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  if (!canViewOwnCommissions(actorResult.actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const daysRaw = Number(req.nextUrl.searchParams.get("days") ?? "90");
  const days = Number.isFinite(daysRaw) ? Math.min(Math.max(Math.round(daysRaw), 7), 366) : 90;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_my_commission_statement", { p_days: days });
  if (error) {
    console.error("[api/agent/commissions] rpc failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  const me = (data ?? {}) as AgentStatement;
  // « ≈ 7 » on each parcel of the road: rate × delivery rate, computed here, never in the browser.
  if (me.way) {
    me.way.likely_each = likelyPerParcel({ enabled: !!me.enabled, rate: me.rate?.amount ?? null, deliveryRate: me.delivery_rate ?? null });
  }
  return NextResponse.json({ data: me });
}

export const GET = withRouteErrors("/api/agent/commissions", "GET", handleGET);
