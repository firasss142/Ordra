import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import { canScanWarehouse } from "@/lib/role-permissions";
import { ReceiveDesk } from "@/components/warehouse/desk/ReceiveDesk";
import { deskDates } from "@/lib/warehouse/desk-server";

export const dynamic = "force-dynamic";

/**
 * Entrepôt › Recevoir — its own page since 2026-10-05 (prototypes/entrepot-desk-v1.html).
 * It was a tab hidden in Stock, and no reception had ever been settled.
 * The warehouse agent keeps the phone's dock flow, still reached from Stock.
 */
export default async function WarehouseReceivePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const user = await getServerUser();
  if (!user) redirect(`/${locale}/login`);
  if (!canScanWarehouse(user.role)) redirect(`/${locale}/queue`);
  if (user.role === "warehouse_agent") redirect(`/${locale}/warehouse/stock?tab=receptions`);

  const { marketId, marketCode } = await getActiveMarketScope(user);
  const { today } = deskDates(locale, marketId);
  return <ReceiveDesk market={marketCode === "ly" ? "ly" : "tn"} marketId={marketId} role={user.role} today={today} />;
}
