import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canViewOrders } from "@/lib/order-permissions";
import { listQuerySchema } from "@/lib/orders/list-filters";
import { applyOrderListFilters, type FilterBuilder } from "@/lib/orders/list-query";
import { DEFAULT_ARCHIVE_AFTER_DAYS } from "@/lib/orders/archive-scope";
import { getMarketSetting } from "@/lib/settings/getMarketSetting";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

const TABS = ["eligible", "archived", "recent", "deleted"] as const;

type CountQuery = FilterBuilder & PromiseLike<{ count: number | null; error: unknown }>;

/**
 * Archivées' header and tabs (prototype `archivePage`): how many finished orders
 * sit in each tab, how many were deleted, and the market's « Ranger tout seul »
 * delay (0 = off). Each count is the tab's own query (lib/orders/list-query)
 * with no other filter, so a tab's number is what opening it shows.
 */
async function handleGET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (actor.role !== "super_admin" && actor.role !== "market_manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const actorMarketId = actor.market_id ?? "";
  const marketId = actor.role === "super_admin" ? req.nextUrl.searchParams.get("market_id") || null : actorMarketId;
  if (marketId && !canViewOrders(actor.role, marketId, actorMarketId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const raw = marketId ? Number(await getMarketSetting(supabase, marketId, "auto_archive_after_days", String(DEFAULT_ARCHIVE_AFTER_DAYS))) : DEFAULT_ARCHIVE_AFTER_DAYS;
  const ruleDays = Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 0;
  const ctx = { marketId, now: new Date(), todayStartIso: null, uploadedTodayIds: [], archiveAfterDays: ruleDays || DEFAULT_ARCHIVE_AFTER_DAYS };

  const results = await Promise.all(
    TABS.map((state) =>
      applyOrderListFilters(
        supabase.from("orders").select("id", { count: "exact", head: true }) as unknown as CountQuery,
        listQuerySchema.parse({ scope: "archive", state }),
        ctx,
      ),
    ),
  );
  if (results.some((r) => r.error)) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  const [eligible, archived, recent, deleted] = results.map((r) => r.count ?? 0);
  return NextResponse.json(
    { data: { eligible, archived, recent, deleted, finished: eligible + archived + recent, rule_days: ruleDays } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export const GET = withRouteErrors("/api/orders/archive/counts", "GET", handleGET);
