import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { searchCustomersByPhone } from "@/lib/follow-ups/search";
import { getActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supabase = await createClient();

    const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;
  const phone = (req.nextUrl.searchParams.get("phone") ?? "").trim();
  const marketId = req.nextUrl.searchParams.get("market_id") ?? undefined;

  if (!phone) {
    return NextResponse.json({ data: [] });
  }

  try {
    const results = await searchCustomersByPhone(supabase, {
      phone,
      role,
      actorId: actor.id,
      actorMarketId: actor.market_id ?? null,
      marketId: role === "super_admin" ? marketId : undefined,
    });
    return NextResponse.json({ data: results });
  } catch (err) {
    console.error("[GET /api/customers/search]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
