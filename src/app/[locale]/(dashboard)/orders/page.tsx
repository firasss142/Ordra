import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OrdersPageClient } from "./OrdersPageClient";
import type { Locale } from "@/types";

export const dynamic = "force-dynamic";

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

  // Resolve user's market label + currency for header + formatting
  let userMarketLabel = "";
  let userMarketCurrency = "TND";
  if (profile.market_id) {
    const { data: market } = await supabase
      .from("markets")
      .select("name, currency")
      .eq("id", profile.market_id)
      .single();
    if (market) {
      userMarketLabel = market.name;
      userMarketCurrency = market.currency ?? "TND";
    }
  }

  // Prefetch the user's default first page (no filters) so SWR hydrates instantly
  // for managers. Super admins start in "all markets" mode — they'll trigger a
  // client fetch on mount, which is fine since they're usually picking a market.
  let fallbackFirstPage: { rows: unknown[]; nextCursor: null } = { rows: [], nextCursor: null };
  if (profile.role === "market_manager" && profile.market_id) {
    const { data } = await supabase
      .from("orders")
      .select(
        "id, external_id, market_id, customer_name, customer_phone, customer_city, " +
          "product_id, product_name, variant_label, quantity, total_price, status, " +
          "assigned_to, carrier_id, rejection_reason, callback_scheduled_at, " +
          "created_at, updated_at",
      )
      .eq("market_id", profile.market_id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(50);
    if (data) fallbackFirstPage = { rows: data, nextCursor: null };
  }

  return (
    <OrdersPageClient
      role={profile.role}
      userMarketId={profile.market_id ?? ""}
      userMarketLabel={userMarketLabel}
      userMarketCurrency={userMarketCurrency}
      locale={params.locale as Locale}
      fallbackFirstPage={fallbackFirstPage as never}
    />
  );
}
