import { NextRequest, NextResponse } from "next/server";
import { getActor } from "@/lib/auth/actor";
import { listMarketsFor } from "@/lib/markets/list";
import { createClient } from "@/lib/supabase/server";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  if (role !== "super_admin" && !actor.market_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Réglages › Marchés: every market, inactive ones included (or one switched
  // off could never be switched back on), with the label sender. Uncached —
  // it is read right after an edit.
  if (req.nextUrl.searchParams.get("detail") === "1") {
    if (role !== "super_admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("markets")
      .select("id, code, name, language, currency, direction, is_active, sender_name, sender_address, sender_phone")
      .order("name");
    if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    return NextResponse.json({ data });
  }

  const data = await listMarketsFor(role, actor.market_id);
  return NextResponse.json({ data });
}

export const GET = withRouteErrors("/api/markets", "GET", handleGET);
