import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { calculateConfirmationRate } from "@/lib/metrics";

const ACTIONED_STATUSES = new Set(["confirmed", "uploaded", "rejected"]);
const CONFIRMED_STATUSES = new Set(["confirmed", "uploaded"]);

function toDateStr(isoString: string): string {
  return isoString.slice(0, 10);
}

function utcDayStr(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function buildDaySeries(
  agentId: string,
  rows: Array<{ actor_id: string | null; status_to: string; created_at: string }>,
  days: number
): Array<{ day: string; rate: number | null; actioned: number }> {
  const agentRows = rows.filter((r) => r.actor_id === agentId);

  const byDay = new Map<string, { actioned: number; confirmed: number }>();
  for (const row of agentRows) {
    const day = toDateStr(row.created_at);
    if (!byDay.has(day)) byDay.set(day, { actioned: 0, confirmed: 0 });
    const entry = byDay.get(day)!;
    if (ACTIONED_STATUSES.has(row.status_to)) entry.actioned++;
    if (CONFIRMED_STATUSES.has(row.status_to)) entry.confirmed++;
  }

  const series: Array<{ day: string; rate: number | null; actioned: number }> = [];
  const todayMs = Date.now();

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(todayMs - i * 86400000);
    const dayStr = utcDayStr(d);
    const entry = byDay.get(dayStr);
    if (!entry || entry.actioned === 0) {
      series.push({ day: dayStr, rate: null, actioned: 0 });
    } else {
      series.push({
        day: dayStr,
        rate: calculateConfirmationRate(entry.confirmed, entry.actioned),
        actioned: entry.actioned,
      });
    }
  }

  return series;
}

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (actor.role === "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = req.nextUrl.searchParams;
  const agentIdsParam = params.get("agent_ids");
  const marketId = params.get("market_id") ?? actor.market_id;
  const days = Math.min(Math.max(parseInt(params.get("days") ?? "14", 10) || 14, 1), 90);

  if (!agentIdsParam) {
    return NextResponse.json({ error: "agent_ids is required" }, { status: 400 });
  }

  if (actor.role === "super_admin" && !params.get("market_id")) {
    return NextResponse.json({ error: "market_id is required for super_admin" }, { status: 400 });
  }

  const agentIds = agentIdsParam.split(",").map((s) => s.trim()).filter(Boolean);

  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);

  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("order_history")
    .select("actor_id, status_to, created_at")
    .in("actor_id", agentIds)
    .gte("created_at", since.toISOString())
    .lte("created_at", new Date().toISOString())
    .limit(100000);

  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const historyRows = rows ?? [];
  const data = agentIds.map((agentId) => ({
    agent_id: agentId,
    series: buildDaySeries(agentId, historyRows, days),
  }));

  void marketId; // used for future market isolation checks if needed

  return NextResponse.json({ data });
}
