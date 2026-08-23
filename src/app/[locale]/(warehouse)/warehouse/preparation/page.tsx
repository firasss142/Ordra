import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import { canScanWarehouse } from "@/lib/role-permissions";
import { createClient } from "@/lib/supabase/server";
import { PreparationConsole } from "@/components/warehouse/console/PreparationConsole";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import { getZoneIndex } from "@/lib/warehouse/zone-index-cache";
import { zoneForOrder } from "@/lib/warehouse/zone-index";

export const dynamic = "force-dynamic";

const PAGE_LIMIT = 200;
/** Used only until a market sets `goal_daily_scanned`. */
const DEFAULT_DAILY_GOAL = 40;

/**
 * Préparation. The queue is prefetched server-side so the bench has rows the
 * moment the page paints — an operator standing at a packing table should not
 * watch a spinner.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const user = await getServerUser();
  if (!user) redirect(`/${locale}/login`);
  if (!canScanWarehouse(user.role)) redirect(`/${locale}/queue`);

  const { marketId: scope, marketCode } = await getActiveMarketScope(user);

  const supabase = await createClient();
  const [{ data }, zoneIndex, { data: goalRow }] = await Promise.all([
    supabase.rpc("get_to_label_orders", {
      p_market_id: scope,
      p_limit: PAGE_LIMIT,
      p_cursor_created_at: null,
      p_cursor_id: null,
    }),
    getZoneIndex(supabase),
    // The daily target is a market setting, never a constant in the component.
    supabase
      .from("settings")
      .select("value")
      .eq("market_id", scope)
      .eq("key", "goal_daily_scanned")
      .maybeSingle<{ value: unknown }>(),
  ]);

  // Settings are stored both as a bare value and as { value }, depending on
  // when the row was written. Read both shapes rather than trusting one.
  const raw = goalRow?.value;
  const unwrapped =
    raw && typeof raw === "object" && "value" in raw ? (raw as { value: unknown }).value : raw;
  const dailyGoal = Number.isFinite(Number(unwrapped)) && Number(unwrapped) > 0
    ? Number(unwrapped)
    : DEFAULT_DAILY_GOAL;

  const orders = ((data ?? []) as unknown as WarehouseOrderRow[]).map((row) => ({
    ...row,
    zone: zoneForOrder(row, zoneIndex),
  }));

  /*
   * What gets scanned differs by market: Libya scans Darb's pre-printed
   * sticker, which the OMS cannot resolve on its own, so the operator picks
   * the row first. Tunisia scans the QR on our own label, which IS the order
   * id and resolves itself.
   *
   * Cross-market scope ("all") falls back to the self-resolving mode — it is a
   * super-admin overview, not a packing bench, and a sticker scanned there has
   * no single market to bind to.
   */
  const market: "ly" | "tn" = marketCode === "ly" ? "ly" : "tn";

  return <PreparationConsole market={market} initialOrders={orders} dailyGoal={dailyGoal} />;
}
