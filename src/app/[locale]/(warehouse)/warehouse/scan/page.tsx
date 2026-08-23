import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import { canScanWarehouse } from "@/lib/role-permissions";
import { createClient } from "@/lib/supabase/server";
import { ScanModeClient } from "@/components/warehouse/console/ScanModeClient";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";
import { getZoneIndex } from "@/lib/warehouse/zone-index-cache";
import { zoneForOrder } from "@/lib/warehouse/zone-index";

export const dynamic = "force-dynamic";

/**
 * Scan mode — the packing bench on its own screen.
 *
 * Préparation is a queue you read; this is a station you stand at. Large type,
 * one parcel at a time, usable on a tablet propped next to the tape gun. It
 * shares ScanStation with the Préparation panel, so the two can never disagree
 * about what a refusal means.
 *
 * Tunisia has no coloured rolls and its QR resolves the order by itself, so
 * scan mode is a Libya screen; a Tunisian scope is sent back to the queue.
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
  if (marketCode !== "ly") redirect(`/${locale}/warehouse/preparation`);

  const supabase = await createClient();
  const [{ data }, zoneIndex] = await Promise.all([
    supabase.rpc("get_to_label_orders", {
      p_market_id: scope,
      p_limit: 200,
      p_cursor_created_at: null,
      p_cursor_id: null,
    }),
    getZoneIndex(supabase),
  ]);

  const orders = ((data ?? []) as WarehouseOrderRow[]).map((row) => ({
    ...row,
    zone: zoneForOrder(row, zoneIndex),
  }));

  return <ScanModeClient locale={locale} initialOrders={orders} />;
}
