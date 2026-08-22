import type { NextRequest } from "next/server";
import { SCOPE_COOKIE } from "@/lib/auth/market-scope";
import { isValidScope, marketIdToCode, scopeToMarketId, type MarketCode } from "@/lib/markets";

/**
 * Which market a warehouse request is about.
 *
 * Super-admins pick a market in the topbar and every warehouse screen must
 * obey it. The routes used to pass `null` for them, so a super-admin with
 * "Libye" selected saw Tunisian orders on a bench whose scan flow is
 * market-specific. An explicit `?market_id` wins; otherwise the scope cookie
 * decides; a non-super-admin is always pinned to their own market.
 */
export interface WarehouseScope {
  marketId: string | null;
  marketCode: MarketCode | null;
  currency: string;
}

const CURRENCY: Record<MarketCode, string> = { tn: "TND", ly: "LYD" };

export function resolveWarehouseScope(
  req: NextRequest,
  actor: { role: string; market_id: string | null },
): WarehouseScope {
  const requested = req.nextUrl.searchParams.get("market_id");
  const cookieScope = req.cookies.get(SCOPE_COOKIE)?.value;

  const marketId =
    actor.role !== "super_admin"
      ? (actor.market_id ?? null)
      : requested && requested !== "all"
        ? requested
        : isValidScope(cookieScope)
          ? scopeToMarketId(cookieScope)
          : null;

  const marketCode = marketIdToCode(marketId);
  return {
    marketId,
    marketCode,
    // Cross-market ("all") has no single currency. TND is the house default,
    // and the figure is always labelled, never a bare number.
    currency: marketCode ? CURRENCY[marketCode] : "TND",
  };
}
