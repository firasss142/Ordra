import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/auth/server-user";
import { canScanWarehouse } from "@/lib/role-permissions";
import { ReturnsQueue } from "@/components/warehouse/ReturnsQueue";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";

export const dynamic = "force-dynamic";

async function prefetchReturns(
  marketScope: string | null,
): Promise<WarehouseOrderRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("orders")
    .select(
      "id, customer_name, customer_phone, customer_city, customer_address, product_id, product_name, variant_label, quantity, total_price, status, created_at",
    )
    .eq("status", "to_be_returned")
    .order("created_at", { ascending: true })
    .limit(200);
  if (marketScope) query = query.eq("market_id", marketScope);

  const { data } = await query;
  return ((data ?? []) as unknown as Array<
    Omit<WarehouseOrderRow, "current_stock" | "low_stock_threshold">
  >).map((o) => ({
    ...o,
    current_stock: null,
    low_stock_threshold: null,
  }));
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

  const scope = user.role !== "super_admin" ? user.market_id : null;
  const fallbackRows = await prefetchReturns(scope);

  return (
    <ReturnsQueue
      marketId={user.role === "super_admin" ? null : user.market_id}
      fallbackRows={fallbackRows}
    />
  );
}
