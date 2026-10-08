import { cookies } from "next/headers";
import {
  isValidScope,
  marketIdToCode,
  scopeToMarketId,
  type MarketCode,
  type MarketScope,
} from "@/lib/markets";
import type { AuthUser } from "@/types";

export const SCOPE_COOKIE = "oms_scope_market";
export const SCOPE_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
const DEFAULT_SUPER_ADMIN_SCOPE: MarketScope = "tn";

export interface ActiveMarketScope {
  scope: MarketScope;
  marketId: string | null;
  marketCode: MarketCode | null;
}

/**
 * The super-admin's market as the scope cookie says it — the ONE reading of that cookie. Pages
 * (below) and API routes (lib/warehouse/scope.ts) must agree, or a screen paints one market from
 * the server and swaps in another from SWR. No cookie, or a bad one: the default, never « all ».
 */
export function scopeFromCookie(raw: string | undefined): MarketScope {
  return isValidScope(raw) ? raw : DEFAULT_SUPER_ADMIN_SCOPE;
}

export async function getActiveMarketScope(user: AuthUser): Promise<ActiveMarketScope> {
  if (user.role !== "super_admin") {
    const code = marketIdToCode(user.market_id);
    return {
      scope: code ?? DEFAULT_SUPER_ADMIN_SCOPE,
      marketId: user.market_id,
      marketCode: code,
    };
  }

  const cookieStore = await cookies();
  const scope = scopeFromCookie(cookieStore.get(SCOPE_COOKIE)?.value);
  const marketId = scopeToMarketId(scope);
  return {
    scope,
    marketId,
    marketCode: scope === "all" ? null : scope,
  };
}
