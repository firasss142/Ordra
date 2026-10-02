import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { canScanWarehouse } from "@/lib/role-permissions";
import { ProductStockView } from "@/components/warehouse/product/ProductStockView";

export const dynamic = "force-dynamic";

/**
 * Entrepôt › Stock › one product: the free figure, the split by building, the
 * product's own movements, and the way to count it. Market isolation is the
 * stock route's (RLS + the actor's market): a product of another market is
 * simply not in the list, and the page says so.
 */
export default async function WarehouseProductPage({
  params,
}: {
  params: Promise<{ locale: string; productId: string }>;
}) {
  const { locale, productId } = await params;
  const user = await getServerUser();
  if (!user) redirect(`/${locale}/login`);
  if (!canScanWarehouse(user.role)) redirect(`/${locale}/queue`);

  return <ProductStockView productId={productId} locale={locale} />;
}
