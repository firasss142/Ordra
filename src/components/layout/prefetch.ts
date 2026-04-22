import { preload } from "swr";
import { fetcher } from "@/lib/swr-config";
import type { AuthUser } from "@/types";

function todayRangeParams(): string {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return `from_date=${from}&to_date=${to}`;
}

/**
 * Warm the SWR cache for a sidebar destination before the user clicks.
 * Called on link hover by NavItem — idempotent + deduped at the SWR layer.
 * Only pre-loads endpoints whose SWR keys we know match what the page will use.
 * Other routes still get `router.prefetch(href)` for fast navigation.
 */
export function prefetchForRoute(route: string, user: AuthUser): void {
  if (route === "dashboard") {
    const range = todayRangeParams();
    preload(`/api/metrics?${range}`, fetcher);
    if (user.role === "super_admin") {
      preload(`/api/markets`, fetcher);
    }
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

  // orders, products, leads, warehouse: data keys depend on marketId + pagination
  // and vary by consumer — skip SWR preload to avoid 404s on guessed keys.
  // `router.prefetch(href)` in NavItem still warms the route chunk.
}
