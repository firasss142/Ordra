import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { canScanWarehouse } from "@/lib/role-permissions";
import { StockConsole } from "@/components/warehouse/console/StockConsole";
import { StockDesk } from "@/components/warehouse/desk/StockDesk";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import { deskDates } from "@/lib/warehouse/desk-server";

export const dynamic = "force-dynamic";

/**
 * Entrepôt › Stock — units, for the people who hold them.
 *
 * Distinct from /dashboard/stock, which values the same shelves at COGS and
 * stays super-admin. Everyone who can scan can count.
 */
export default async function WarehouseStockPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { locale } = await params;
  const { tab } = await searchParams;
  const user = await getServerUser();
  if (!user) redirect(`/${locale}/login`);
  if (!canScanWarehouse(user.role)) redirect(`/${locale}/queue`);

  // The agent's phone keeps its console (levels, its dock flow, the journal);
  // the desk gets the Aurore screen — Recevoir has its own page there.
  if (user.role === "warehouse_agent") return <StockConsole locale={locale} role={user.role} />;

  // Receptions left Stock for their own page; old links follow them there.
  if (tab === "receptions") redirect(`/${locale}/warehouse/receive`);

  const { marketId, marketCode } = await getActiveMarketScope(user);
  const { dateLabel } = deskDates(locale, marketId);
  return <StockDesk market={marketCode === "ly" ? "ly" : "tn"} dateLabel={dateLabel} />;
}
