import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMarketSetting } from "@/lib/settings/getMarketSetting";
import { getActor } from "@/lib/auth/actor";

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

  return NextResponse.json({ max_call_attempts });
}
