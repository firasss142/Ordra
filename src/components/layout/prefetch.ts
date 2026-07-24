import { preload } from "swr";
import { fetcher } from "@/lib/swr-config";
import { isValidScope, scopeToMarketId } from "@/lib/markets";
import type { AuthUser } from "@/types";

// Same cookie the MarketScopeProvider reads/writes (client context — the
// server-only SCOPE_COOKIE constant lives behind next/headers).
const SCOPE_COOKIE = "oms_scope_market";

function readScopeCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${SCOPE_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Warm the SWR cache for a sidebar destination before the user clicks.
 * Called on link hover by NavItem — idempotent + deduped at the SWR layer.
 * Only pre-loads endpoints whose SWR keys we know match what the page will use.
 * Other routes still get `router.prefetch(href)` for fast navigation.
 */
export function prefetchForRoute(route: string, user: AuthUser): void {
  if (route === "dashboard") {
    // Reproduce DashboardClient's buildSummaryKey byte-for-byte (raw template,
    // param order from_date/to_date/market_id) so the preload hits its cache key.
    const today = new Date().toISOString().slice(0, 10);
    let marketId: string;
    if (user.role === "super_admin") {
      const raw = readScopeCookie();
      const scope = isValidScope(raw) ? raw : "tn";
      marketId = scope === "all" ? "all" : scopeToMarketId(scope) ?? "all";
    } else {
      marketId = user.market_id ?? "";
    }
    preload(
      `/api/dashboard/summary?from_date=${today}&to_date=${today}&market_id=${marketId}`,
      fetcher,
    );
    return;
  }

  if (route === "team") {
    preload(`/api/team`, fetcher);
    return;
  }

  if (route === "settings") {
    if (user.role === "super_admin") {
      preload(`/api/markets`, fetcher);
    }
    if (user.market_id) {
      preload(`/api/settings/${user.market_id}`, fetcher);
    }
    return;
  }

  if (route === "orders" && user.market_id) {
    // The unassigned tab's assignment board is the orders page's default
    // entry point from the sidebar badge — warm its data alongside the route.
    preload(`/api/orders/unassigned?market_id=${user.market_id}&limit=100`, fetcher);
    preload(`/api/agents/capacity?market_id=${user.market_id}`, fetcher);
    preload(`/api/assignment-rules?market_id=${user.market_id}`, fetcher);
    return;
  }

  if (route === "confirmation-flow" && user.market_id) {
    const today = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    preload(
      `/api/confirmation-flow/overview?market_id=${user.market_id}&from_date=${from}&to_date=${today}`,
      fetcher
    );
    preload(
      `/api/confirmation-flow/callbacks-due?market_id=${user.market_id}&within_minutes=30`,
      fetcher
    );
    return;
  }

  // orders, products, leads, warehouse: data keys depend on marketId + pagination
  // and vary by consumer — skip SWR preload to avoid 404s on guessed keys.
  // `router.prefetch(href)` in NavItem still warms the route chunk.
}
