/**
 * Which market a desk route acts on. The same rule as the console:
 *   market_manager → own market; whatever the request names is ignored
 *   super_admin    → must name it (query `market_id` or body `market_id`)
 *   anyone else    → refused (an agent works their own Prospects tab)
 */
import { NextResponse } from "next/server";
import { canUseProspectConsole } from "@/lib/role-permissions";
import { UUID_RE } from "@/lib/investors/admin-route";
import type { Role } from "@/types";

export function deskMarket(
  actor: { role: Role; market_id: string | null },
  requested: string | null | undefined,
): { marketId: string } | { response: NextResponse } {
  if (!canUseProspectConsole(actor.role)) return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  const marketId = actor.role === "super_admin" ? requested ?? null : actor.market_id;
  if (!marketId || !UUID_RE.test(marketId)) return { response: NextResponse.json({ error: "market_required" }, { status: 400 }) };
  return { marketId };
}
