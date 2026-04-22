import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  const marketId =
    actor.role === "super_admin"
      ? (req.nextUrl.searchParams.get("market_id") ?? actor.market_id ?? "")
      : (actor.market_id ?? "");

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
