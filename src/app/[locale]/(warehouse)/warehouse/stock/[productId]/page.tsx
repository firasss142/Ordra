import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { canScanWarehouse } from "@/lib/role-permissions";
import { ProductStockView } from "@/components/warehouse/product/ProductStockView";

export const dynamic = "force-dynamic";

/**
 * Entrepôt › Stock › one product: the free figure, the split by building, the
 * product's own movements, and the way to count it — the phone's `R.product`
 * for an agent, the desk's `C.product` for everyone else. Market isolation is
 * the stock route's (RLS + the actor's market): a product of another market is
 * simply not in the list, and the page says so.
 */
export default async function WarehouseProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; productId: string }>;
  searchParams: Promise<{ warehouse_id?: string }>;
}) {
  const { locale, productId } = await params;
  const { warehouse_id } = await searchParams;
  const user = await getServerUser();
  if (!user) redirect(`/${locale}/login`);
  if (!canScanWarehouse(user.role)) redirect(`/${locale}/queue`);

  const isAgent = user.role === "warehouse_agent";
  return (
    <ProductStockView
      productId={productId}
      locale={locale}
      variant={isAgent ? "agent" : "desk"}
      // The desk's building switch; an agent's building comes from their own
      // assignment (/api/warehouse/sites), never from the address.
      siteId={isAgent ? null : warehouse_id && warehouse_id !== "all" ? warehouse_id : null}
    />
  );
}
