import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewOwnPortfolio } from "@/lib/investor-permissions";
import { loadPortfolio } from "@/lib/investors/portfolio";

export const dynamic = "force-dynamic";

/**
 * The investor's own portfolio.
 *
 * The investor id comes from the session via getActor() and is NEVER read from
 * a query parameter or body — that is the single control preventing one
 * investor from reading another's position, since the service-role client used
 * here bypasses RLS.
 */
export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canViewOwnPortfolio(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();

  try {
    const portfolio = await loadPortfolio(admin, actor.id);

    if (!portfolio) {
      // The user has the investor role but no investors row yet.
      return NextResponse.json({ error: "Investor profile not found" }, { status: 404 });
    }

    return NextResponse.json(
      { data: portfolio },
      { headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=45" } }
    );
  } catch (err) {
    console.error("[GET /api/investor/portfolio]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
