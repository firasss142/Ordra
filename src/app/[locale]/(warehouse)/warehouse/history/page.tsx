import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/auth/server-user";
import { canScanWarehouse } from "@/lib/role-permissions";
import { WarehouseHistoryClient } from "@/components/warehouse/WarehouseHistoryClient";
import { getWarehouseHistoryPage } from "@/lib/warehouse/history-fetch";
import type { WarehouseHistoryPage } from "@/hooks/useWarehouseList";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const user = await getServerUser();
  if (!user) redirect(`/${locale}/login`);
  if (!canScanWarehouse(user.role)) redirect(`/${locale}/queue`);

  const supabase = await createClient();
  const scopeMarket = user.role !== "super_admin" ? user.market_id : null;

  // Server-prefetch the first page so WarehouseHistoryClient renders immediately
  // without a client-side loading flash. getWarehouseHistoryPage contains the
  // same merge+sort logic as the API route, avoiding any duplication.
  const fallbackFirstPage: WarehouseHistoryPage = await getWarehouseHistoryPage(
    supabase,
    { limit: 50, kind: "all" },
    scopeMarket,
  );

  return (
    <WarehouseHistoryClient
      locale={locale}
      marketId={user.role === "super_admin" ? null : user.market_id}
      fallbackFirstPage={fallbackFirstPage}
    />
  );
}
