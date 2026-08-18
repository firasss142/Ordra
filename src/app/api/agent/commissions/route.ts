import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewOwnCommissions } from "@/lib/role-permissions";
import type { AgentCommissions } from "@/lib/commissions/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/agent/commissions?days=60 — "Mes commissions".
 * No agent parameter exists, by design: get_my_commissions() reads auth.uid().
 */
export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  if (!canViewOwnCommissions(actorResult.actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const daysRaw = Number(req.nextUrl.searchParams.get("days") ?? "60");
  const days = Number.isFinite(daysRaw) ? Math.min(Math.max(Math.round(daysRaw), 7), 366) : 60;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_my_commissions", { p_days: days });
  if (error) {
    console.error("[api/agent/commissions] rpc failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  return NextResponse.json({ data: (data ?? {}) as AgentCommissions });
}
