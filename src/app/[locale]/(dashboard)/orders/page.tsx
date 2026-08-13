import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/auth/server-user";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import { getAllActiveMarkets, getDefaultMarketId } from "@/lib/markets/list";
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from "@/lib/orders/list-filters";
import { resolveProductDisplayName } from "@/lib/orders/display-name";
import type { OrderNameSource } from "@/lib/orders/display-name";
import { OrdersPageClient } from "./OrdersPageClient";
import type { Locale } from "@/types";

export const dynamic = "force-dynamic";

const LIST_COLS =
  "id, external_id, external_platform, market_id, customer_name, customer_phone, customer_city, " +
  "product_id, product_name, variant_label, quantity, total_price, status, " +
  "assigned_to, carrier_id, rejection_reason, callback_scheduled_at, " +
  "created_at, updated_at, terminal_at, archived_at, archived_by, " +
  // Must stay in sync with LIST_SELECT in /api/orders/list — this SSR prefetch
  // backs the first paint, and a missing embed would show external product
  // names that visibly swap once SWR revalidates.
  "product:products(name)";

export default async function OrdersPage({
  params,
  searchParams,
}: {
  params: { locale: string };
  searchParams?: { limit?: string };
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

  // Honor `?limit=` from the URL for SSR prefetch so the first paint matches the
  // user's chosen page size. Fall back to default if missing or not allowed.
  const requestedLimit = Number(searchParams?.limit);
  const prefetchLimit =
    Number.isFinite(requestedLimit) && (PAGE_SIZE_OPTIONS as readonly number[]).includes(requestedLimit)
      ? requestedLimit
      : DEFAULT_PAGE_SIZE;

  // Parallelize: market label + orders first page + agents — all independent after profile
  const [marketResult, ordersResult, agentsResult] = await Promise.all([
    user.market_id
      ? supabase
          .from("markets")
          .select("name, currency, code")
          .eq("id", user.market_id)
          .single()
      : Promise.resolve({ data: null }),

    prefetchMarketId
      ? supabase
          .from("orders")
          // Exact count alongside the rows: this page hydrates SWR directly and
          // is never refetched, so without it the result summary would sit on
          // its placeholder until the first filter change.
          .select(LIST_COLS, { count: "exact" })
          .eq("market_id", prefetchMarketId)
          .neq("status", "deleted")
          // Must match /api/orders/list exactly. This page hydrates SWR and is
          // never refetched, so a mismatch would paint archived orders once and
          // then drop them on the first filter change.
          .is("archived_at", null)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(prefetchLimit)
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
  const userMarketCode = marketResult.data?.code ?? "TN";
  const fallbackFirstPage = ordersResult.data
    ? {
        rows: (
          ordersResult.data as unknown as Array<Record<string, unknown> & OrderNameSource>
        ).map((r) => {
          const { product, ...rest } = r;
          return { ...rest, product_display_name: resolveProductDisplayName(r) };
        }),
        nextCursor: null,
        total: (ordersResult as { count?: number | null }).count ?? null,
      }
    : { rows: [], nextCursor: null, total: null };
  const fallbackAgents = agentsResult.data ?? [];

  return (
    <OrdersPageClient
      role={user.role}
      userId={user.id}
      userMarketId={user.market_id ?? superAdminInitialMarketId}
      userMarketLabel={userMarketLabel}
      userMarketCurrency={userMarketCurrency}
      userMarketCode={userMarketCode}
      locale={params.locale as Locale}
      fallbackFirstPage={fallbackFirstPage as never}
      initialMarketId={superAdminInitialMarketId}
      fallbackAgents={fallbackAgents}
    />
  );
}
