import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { canScanWarehouse } from "@/lib/role-permissions";
import { getWarehouseSummary } from "@/lib/warehouse/summary";
import { WarehouseOverviewClient } from "@/components/warehouse/WarehouseOverviewClient";

export const dynamic = "force-dynamic";

export default async function WarehouseOverviewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const user = await getServerUser();
  if (!user) redirect(`/${locale}/login`);

  if (!canScanWarehouse(user.role)) {
    redirect(`/${locale}/queue`);
  }

  // Warehouse agents don't see the overview — they jump straight to the queue.
  if (user.role === "warehouse_agent") {
    redirect(`/${locale}/warehouse/to-label`);
  }

  const isSuperAdmin = user.role === "super_admin";
  const initialMarketId: string | "all" | null = isSuperAdmin
    ? "all"
    : user.market_id;

  const initialSummary = await getWarehouseSummary({
    role: user.role,
    actorMarketId: user.market_id,
    marketId: isSuperAdmin ? "all" : null,
  });

  return (
    <WarehouseOverviewClient
      user={user}
      locale={locale}
      initialSummary={initialSummary}
      initialMarketId={initialMarketId}
    />
  );
}
