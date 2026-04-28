import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/auth/server-user";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import { canScanWarehouse } from "@/lib/role-permissions";
import { ReturnsQueue } from "@/components/warehouse/ReturnsQueue";
import { buildQueuePageMeta } from "@/lib/warehouse/queue-cursor";
import type { WarehouseQueuePage } from "@/hooks/useWarehouseQueue";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";

export const dynamic = "force-dynamic";

const PAGE_LIMIT = 50;

async function prefetchReturns(
  marketScope: string | null,
): Promise<WarehouseQueuePage> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_to_be_returned_orders", {
    p_market_id: marketScope,
    p_limit: PAGE_LIMIT + 1,
    p_cursor_created_at: null,
    p_cursor_id: null,
  });
  const raw = (data ?? []) as Array<
    Omit<WarehouseOrderRow, "current_stock" | "low_stock_threshold">
  >;
  const { rows, nextCursor } = buildQueuePageMeta(raw, PAGE_LIMIT);
  const orders: WarehouseOrderRow[] = rows.map((o) => ({
    ...o,
    current_stock: null,
    low_stock_threshold: null,
  }));
  return { orders, nextCursor };
}

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const user = await getServerUser();
  if (!user) redirect(`/${locale}/login`);
  if (!canScanWarehouse(user.role)) redirect(`/${locale}/queue`);

  const { marketId: scope } = await getActiveMarketScope(user);
  const fallbackPage = await prefetchReturns(scope);

  return <ReturnsQueue marketId={scope} fallbackPage={fallbackPage} />;
}
