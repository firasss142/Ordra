import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

async function handleGET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  const marketId =
    actor.role === "super_admin"
      ? (req.nextUrl.searchParams.get("market_id") ?? actor.market_id ?? "")
      : (actor.market_id ?? "");

  // A super_admin on « Tous les marchés » has no market: there is no city list
  // to give, and `market_id = ''` is a Postgres error (720 of them on prod by
  // 2026-10-06). Answer an empty list instead of asking.
  if (!marketId) return NextResponse.json({ data: [] });

  const q = req.nextUrl.searchParams.get("q");

  let query = supabase
    .from("cities")
    .select("id, market_id, name, name_ar, is_active")
    .eq("market_id", marketId)
    .eq("is_active", true);

  if (q) {
    query = query.ilike("name", `%${q}%`);
  }

  const { data, error } = await query.order("name");

  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  return NextResponse.json(
    { data: data ?? [] },
    {
      headers: {
        "Cache-Control": "private, max-age=300, stale-while-revalidate=3600",
      },
    },
  );
}

export const GET = withRouteErrors("/api/cities", "GET", handleGET);
