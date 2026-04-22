import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/auth/server-user";
import { canScanWarehouse } from "@/lib/role-permissions";
import { ToScanQueue } from "@/components/warehouse/ToScanQueue";
import type { WarehouseOrderRow } from "@/lib/warehouse/summary";

export const dynamic = "force-dynamic";

async function prefetchToScan(
  marketScope: string | null,
): Promise<WarehouseOrderRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("orders")
    .select(
      "id, customer_name, customer_phone, customer_city, customer_address, product_id, product_name, variant_label, quantity, total_price, status, created_at, products(current_stock, low_stock_threshold)",
    )
    .eq("status", "confirmed")
    .order("created_at", { ascending: true })
    .limit(200);
  if (marketScope) query = query.eq("market_id", marketScope);

  const { data: confirmed } = await query;
  const ids = (confirmed ?? []).map((o) => o.id);
  if (ids.length === 0) return [];

  const { data: printed } = await supabase
    .from("label_prints")
    .select("order_id")
    .in("order_id", ids);
  const printedSet = new Set((printed ?? []).map((p) => p.order_id));

  return (confirmed ?? [])
    .filter((o) => printedSet.has(o.id))
    .map((o) => {
      const raw = o as Record<string, unknown>;
      const productRaw = raw.products as
        | { current_stock: number | null; low_stock_threshold: number | null }
        | Array<{ current_stock: number | null; low_stock_threshold: number | null }>
        | null;
      const product = Array.isArray(productRaw) ? productRaw[0] ?? null : productRaw;
      const { products: _p, ...rest } = raw;
      return {
        ...(rest as unknown as Omit<
          WarehouseOrderRow,
          "current_stock" | "low_stock_threshold"
        >),
        current_stock: product?.current_stock ?? null,
        low_stock_threshold: product?.low_stock_threshold ?? null,
      };
    });
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
  const fallbackRows = await prefetchToScan(scope);

  return (
    <ToScanQueue
      marketId={user.role === "super_admin" ? null : user.market_id}
      fallbackRows={fallbackRows}
    />
  );
}
