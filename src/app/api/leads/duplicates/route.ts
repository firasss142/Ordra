import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canViewLeads } from "@/lib/lead-permissions";
import { getActor } from "@/lib/auth/actor";
import { findPhoneDuplicates } from "@/lib/leads/duplicates";

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  const phone = req.nextUrl.searchParams.get("phone");
  if (!phone) {
    return NextResponse.json({ error: "phone is required" }, { status: 400 });
  }

  const queryMarketId = req.nextUrl.searchParams.get("market_id");
  const requestedMarketId =
    actor.role === "super_admin"
      ? queryMarketId ?? actor.market_id ?? ""
      : actor.market_id ?? "";

  // Reject explicit cross-market requests for non-super_admin
  if (
    actor.role !== "super_admin" &&
    queryMarketId &&
    queryMarketId !== actor.market_id
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!canViewLeads(actor.role, requestedMarketId, actor.market_id ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const excludeId = req.nextUrl.searchParams.get("exclude_id") ?? undefined;

  const duplicates = await findPhoneDuplicates(supabase, phone, requestedMarketId, excludeId);

  return NextResponse.json({ data: duplicates });
}
