import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { canScanWarehouse } from "@/lib/role-permissions";
import { CountRun } from "@/components/warehouse/count/CountRun";
import { CountDesk } from "@/components/warehouse/desk/CountDesk";
import { getActiveMarketScope } from "@/lib/auth/market-scope";

export const dynamic = "force-dynamic";

/**
 * Entrepôt › Compter — the count run. One product per screen, never-counted
 * first. Reached from « Compter » on Aujourd'hui and from Stock.
 * See plans/entrepot-day-loop-redesign.md.
 */
export default async function WarehouseCountPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ product?: string; warehouse_id?: string }>;
}) {
  const { locale } = await params;
  const { product, warehouse_id } = await searchParams;
  const user = await getServerUser();
  if (!user) redirect(`/${locale}/login`);
  if (!canScanWarehouse(user.role)) redirect(`/${locale}/queue`);

  // The agent's phone keeps its run; the desk counts with the screen of the
  // prototype (it reads the building from ?warehouse_id itself).
  if (user.role === "warehouse_agent") {
    return <CountRun locale={locale} productId={product ?? null} initialSiteId={warehouse_id ?? null} />;
  }
  const { marketCode } = await getActiveMarketScope(user);
  return <CountDesk market={marketCode === "ly" ? "ly" : "tn"} productId={product ?? null} />;
}
