import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAllActiveMarkets, getDefaultMarketId } from "@/lib/markets/list";
import { OrdersPageClient } from "./OrdersPageClient";
import type { Locale } from "@/types";

export const dynamic = "force-dynamic";

const LIST_COLS =
  "id, external_id, market_id, customer_name, customer_phone, customer_city, " +
  "product_id, product_name, variant_label, quantity, total_price, status, " +
  "assigned_to, carrier_id, rejection_reason, callback_scheduled_at, " +
  "created_at, updated_at";

export default async function OrdersPage({
  params,
}: {
  params: { locale: string };
}) {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) redirect(`/${params.locale}/login`);

  const { data: profile } = await supabase
    .from("users")
    .select("role, market_id")
    .eq("id", authUser.id)
    .single();

  if (!profile) redirect(`/${params.locale}/login`);

  // Agents and warehouse agents don't have access to the orders list view
  if (profile.role === "agent") redirect(`/${params.locale}/queue`);
  if (profile.role === "warehouse_agent") redirect(`/${params.locale}/warehouse`);

  // Determine prefetch target market (depends on role + cached markets list)
  const prefetchMarketId =
    profile.role === "market_manager"
      ? profile.market_id
      : profile.role === "super_admin"
        ? getDefaultMarketId(await getAllActiveMarkets())
        : null;

  const superAdminInitialMarketId =
    profile.role === "super_admin" ? prefetchMarketId ?? "" : "";

  // Parallelize: market label + orders first page + agents — all independent after profile
  const [marketResult, ordersResult, agentsResult] = await Promise.all([
    profile.market_id
      ? supabase
          .from("markets")
          .select("name, currency")
          .eq("id", profile.market_id)
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
      role={profile.role}
      userMarketId={profile.market_id ?? superAdminInitialMarketId}
      userMarketLabel={userMarketLabel}
      userMarketCurrency={userMarketCurrency}
      locale={params.locale as Locale}
      fallbackFirstPage={fallbackFirstPage as never}
      initialMarketId={superAdminInitialMarketId}
      fallbackAgents={fallbackAgents}
    />
  );
}
