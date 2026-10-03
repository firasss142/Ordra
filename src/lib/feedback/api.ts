import { NextResponse } from "next/server";
import type { Actor } from "@/lib/auth/actor";
import { UUID_RE } from "@/lib/investors/admin-route";

/**
 * The market a feedback route works in. A market's agents and manager are pinned to their
 * own; a super_admin names one (the scope switcher's market) or is refused.
 */
export function resolveFeedbackMarket(
  actor: Pick<Actor, "role" | "market_id">,
  queryMarketId: string | null,
): { marketId: string } | { response: NextResponse } {
  if (actor.role === "super_admin") {
    if (!queryMarketId || !UUID_RE.test(queryMarketId)) {
      return { response: NextResponse.json({ error: "market_id is required for super_admin" }, { status: 400 }) };
    }
    return { marketId: queryMarketId };
  }
  if (!actor.market_id) return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  return { marketId: actor.market_id };
}

/** SQLSTATEs the feedback RPCs raise, mapped to HTTP. */
export function rpcErrorResponse(error: { code?: string; message?: string } | null, where: string): NextResponse {
  const code = error?.code;
  if (code === "42501") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (code === "22023") return NextResponse.json({ error: error?.message ?? "invalid" }, { status: 400 });
  if (code === "P0002") return NextResponse.json({ error: "not_found" }, { status: 404 });
  console.error(`[api/feedback] ${where}`, error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
