import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { canScanWarehouse } from "@/lib/role-permissions";
import { WarehouseHistoryClient } from "@/components/warehouse/WarehouseHistoryClient";
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

  // The history payload requires keyset merge logic that lives in the API
  // route. Rather than duplicate, we hydrate the client with an empty first
  // page and let SWR fetch /api/warehouse/history on mount. Request is
  // already under the 2s Cache-Control budget.
  const fallbackFirstPage: WarehouseHistoryPage = { rows: [], nextCursor: null };

  return (
    <WarehouseHistoryClient
      locale={locale}
      marketId={user.role === "super_admin" ? null : user.market_id}
      fallbackFirstPage={fallbackFirstPage}
    />
  );
}
