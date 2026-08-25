import { NextRequest, NextResponse } from "next/server";
import { getActor, type Actor } from "@/lib/auth/actor";
import { canViewOwnPortfolio } from "@/lib/investor-permissions";
import { createAdminClient } from "@/lib/supabase/server";
import { marketTimezone } from "@/lib/markets";
import { localDateISO } from "./facts/order-facts";

/**
 * Shared guard for every /api/investor route.
 *
 * SECURITY: the investor id comes from the SESSION only — never from a param
 * or body — because these routes read with the service-role client (investors
 * have no RLS on facts/deals by design). This is the single control against
 * cross-investor disclosure; keep it that way.
 */
export const INVESTOR_CACHE = { "Cache-Control": "private, max-age=15, stale-while-revalidate=45" } as const;

export async function investorActor(req: NextRequest): Promise<{ actor: Actor; admin: ReturnType<typeof createAdminClient>; today: string } | { response: NextResponse }> {
  const r = await getActor(req);
  if ("response" in r) return r;
  if (!canViewOwnPortfolio(r.actor.role)) return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  const admin = createAdminClient();
  const today = localDateISO(new Date().toISOString(), marketTimezone(r.actor.market_id));
  return { actor: r.actor, admin, today };
}
