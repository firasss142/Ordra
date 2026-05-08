import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  const code = req.nextUrl.searchParams.get("code");
  const marketId = req.nextUrl.searchParams.get("market_id");
  if (!code || !marketId) {
    return NextResponse.json(
      { error: "Missing code or market_id" },
      { status: 400 },
    );
  }

  // Market gate: non-super_admins can only ask about their own market
  if (actor.role !== "super_admin" && actor.market_id !== marketId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: carrier, error } = await supabase
    .from("carriers")
    .select("id, delivery_fee, is_active")
    .eq("code", code)
    .eq("market_id", marketId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }

  return NextResponse.json({ carrier: carrier ?? null });
}
