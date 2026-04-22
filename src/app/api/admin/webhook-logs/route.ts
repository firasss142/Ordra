import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (actor.role !== "super_admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get("page") ?? "1", 10));
  const limit = Math.min(
    100,
    Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") ?? "50", 10))
  );
  const storefrontId = req.nextUrl.searchParams.get("storefront_id");
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  let query = supabase
    .from("webhook_delivery_log")
    .select(
      "id, storefront_id, external_id, event_type, status, error_message, created_at",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range(from, to);

  if (storefrontId) query = query.eq("storefront_id", storefrontId);

  const { data, error, count } = await query;
  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  return NextResponse.json({
    data: data ?? [],
    pagination: { page, limit, total: count ?? 0 },
  });
}
