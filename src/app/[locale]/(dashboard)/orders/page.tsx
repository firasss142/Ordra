import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/auth/server-user";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import { getAllActiveMarkets, getDefaultMarketId } from "@/lib/markets/list";
import { OrdersPageClient } from "./OrdersPageClient";
import type { Locale } from "@/types";

export const dynamic = "force-dynamic";

const LIST_COLS =
  "id, external_id, external_platform, market_id, customer_name, customer_phone, customer_city, " +
  "product_id, product_name, variant_label, quantity, total_price, status, " +
  "assigned_to, carrier_id, rejection_reason, callback_scheduled_at, " +
  "created_at, updated_at";

export default async function OrdersPage({
  params,
}: {
  params: { locale: string };
}) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);

  // Agents and warehouse agents don't have access to the orders list view
  if (user.role === "agent") redirect(`/${params.locale}/queue`);
  if (user.role === "warehouse_agent") redirect(`/${params.locale}/warehouse`);

  const supabase = await createClient();
  const { marketId: scopedMarketId } = await getActiveMarketScope(user);
  // Orders list needs a single market for prefetch — fall back to default when "all".
  const prefetchMarketId =
    scopedMarketId ?? (user.role === "super_admin" ? getDefaultMarketId(await getAllActiveMarkets()) : null);

  const superAdminInitialMarketId =
    user.role === "super_admin" ? prefetchMarketId ?? "" : "";

  // Parallelize: market label + orders first page + agents — all independent after profile
  const [marketResult, ordersResult, agentsResult] = await Promise.all([
    user.market_id
      ? supabase
          .from("markets")
          .select("name, currency")
          .eq("id", user.market_id)
          .single()
      : Promise.resolve({ data: null }),

    prefetchMarketId
      ? supabase
          .from("orders")
          .select(LIST_COLS)
          .eq("market_id", prefetchMarketId)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(10)
      : Promise.resolve({ data: null }),

    prefetchMarketId
      ? supabase
          .from("users")
          .select("id, full_name, is_active, market_id")
          .eq("role", "agent")
          .eq("market_id", prefetchMarketId)
      : Promise.resolve({ data: null }),
  ]);

  const userMarketLabel = marketResult.data?.name ?? "";
  const userMarketCurrency = marketResult.data?.currency ?? "TND";
  const fallbackFirstPage = ordersResult.data
    ? { rows: ordersResult.data, nextCursor: null }
    : { rows: [], nextCursor: null };
  const fallbackAgents = agentsResult.data ?? [];

  return (
    <OrdersPageClient
      role={user.role}
      userId={user.id}
      userMarketId={user.market_id ?? superAdminInitialMarketId}
      userMarketLabel={userMarketLabel}
      userMarketCurrency={userMarketCurrency}
      locale={params.locale as Locale}
      fallbackFirstPage={fallbackFirstPage as never}
      initialMarketId={superAdminInitialMarketId}
      fallbackAgents={fallbackAgents}
    />
  );
}
