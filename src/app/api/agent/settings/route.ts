import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMarketSetting } from "@/lib/settings/getMarketSetting";
import { getActor } from "@/lib/auth/actor";
import { DEFAULT_SLA_MINUTES } from "@/types/settings";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  if (role !== "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const max_call_attempts = Number(
    await getMarketSetting(supabase, actor.market_id ?? "", "max_call_attempts", "3")
  );

  // The panel's SLA chip needs this too. Agents cannot read
  // /api/settings/:marketId — canReadSettings allows only super_admin and
  // market_manager — so anything the agent queue displays has to be served
  // here or it stays permanently blank for exactly the role that needs it.
  const sla_minutes = Number(
    await getMarketSetting(
      supabase,
      actor.market_id ?? "",
      "sla_minutes",
      String(DEFAULT_SLA_MINUTES)
    )
  );

  return NextResponse.json({ max_call_attempts, sla_minutes });
}
