import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/auth/server-user";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import { getAllActiveMarkets, getDefaultMarketId } from "@/lib/markets/list";
import { canScanWarehouse } from "@/lib/role-permissions";
import { ToShipCockpit } from "@/components/to-ship/ToShipCockpit";
import type { ToShipRow } from "@/lib/to-ship/types";
import type { OrderStatus } from "@/types/order-status";

export const dynamic = "force-dynamic";

const SHIPPABLE_STATUSES = ["confirmed", "dispatch_scheduled", "scanned"] as const;
const MAX_ROWS = 500;

interface OrderJoinRow {
  id: string;
  customer_name: string;
  customer_city: string | null;
  product_id: string | null;
  product_name: string;
  variant_label: string | null;
  quantity: number;
  total_price: number;
  status: OrderStatus;
  scheduled_dispatch_at: string | null;
  scheduled_dispatch_auto: boolean | null;
  scheduled_dispatch_carrier_id: string | null;
  products: { current_stock: number; low_stock_threshold: number } | null;
}

export default async function DispatchPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const user = await getServerUser();

  if (!user) redirect(`/${locale}/login`);
  if (!canScanWarehouse(user.role)) redirect(`/${locale}/queue`);

  const supabase = await createClient();
  const { marketId: scopedMarketId } = await getActiveMarketScope(user);
  const targetMarketId =
    scopedMarketId ?? getDefaultMarketId(await getAllActiveMarkets());

  if (!targetMarketId) {
    return <ToShipCockpit rows={[]} carriers={[]} currency="TND" />;
  }

  const [ordersResult, marketResult, carriersResult] = await Promise.all([
    supabase
      .from("orders")
      .select(
        "id, customer_name, customer_city, product_id, product_name, variant_label, quantity, total_price, status, scheduled_dispatch_at, scheduled_dispatch_auto, scheduled_dispatch_carrier_id, products!orders_product_id_fkey(current_stock, low_stock_threshold)",
      )
      .eq("market_id", targetMarketId)
      .in("status", SHIPPABLE_STATUSES as unknown as string[])
      .order("created_at", { ascending: true })
      .limit(MAX_ROWS),
    supabase
      .from("markets")
      .select("currency")
      .eq("id", targetMarketId)
      .single(),
    supabase
      .from("carriers")
      .select("id, code")
      .eq("market_id", targetMarketId)
      .eq("is_active", true)
      .order("code", { ascending: true }),
  ]);

  const rawOrders = (ordersResult.data ?? []) as unknown as OrderJoinRow[];
  const rows: ToShipRow[] = rawOrders.map((o) => {
    const product = Array.isArray(o.products) ? o.products[0] : o.products;
    return {
      id: o.id,
      customer_name: o.customer_name,
      customer_city: o.customer_city,
      product_id: o.product_id,
      product_name: o.product_name,
      variant_label: o.variant_label,
      quantity: o.quantity,
      total_price: Number(o.total_price ?? 0),
      status: o.status,
      current_stock: product?.current_stock ?? 0,
      low_stock_threshold: product?.low_stock_threshold ?? 0,
      scheduled_at: o.scheduled_dispatch_at,
      scheduled_auto: o.scheduled_dispatch_auto ?? false,
      scheduled_carrier_id: o.scheduled_dispatch_carrier_id,
    };
  });

  const currency = (marketResult.data as { currency?: string } | null)?.currency ?? "TND";
  const carriers = (carriersResult.data ?? []).map((c) => ({
    id: c.id as string,
    code: c.code as string,
    label: ((c.code as string) ?? "").toUpperCase(),
  }));

  return <ToShipCockpit rows={rows} carriers={carriers} currency={currency} />;
}
