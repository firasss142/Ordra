import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { canScanWarehouse } from "@/lib/role-permissions";
import { WarehouseStockClient } from "@/components/warehouse/console/WarehouseStockClient";

export const dynamic = "force-dynamic";

/**
 * Entrepôt › Stock — units, for the people who hold them.
 *
 * Distinct from /dashboard/stock, which values the same shelves at COGS and
 * stays super-admin. Everyone who can scan can count.
 */
export default async function WarehouseStockPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const user = await getServerUser();
  if (!user) redirect(`/${locale}/login`);
  if (!canScanWarehouse(user.role)) redirect(`/${locale}/queue`);

  return <WarehouseStockClient locale={locale} />;
}
