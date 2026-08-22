import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import { canScanWarehouse } from "@/lib/role-permissions";
import { createClient } from "@/lib/supabase/server";
import { PreparationConsole } from "@/components/warehouse/console/PreparationConsole";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";

export const dynamic = "force-dynamic";

const PAGE_LIMIT = 200;

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
  const { data } = await supabase.rpc("get_to_label_orders", {
    p_market_id: scope,
    p_limit: PAGE_LIMIT,
    p_cursor_created_at: null,
    p_cursor_id: null,
  });

  const orders = (data ?? []) as unknown as WarehouseOrderRow[];

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

  return <PreparationConsole market={market} initialOrders={orders} />;
}
