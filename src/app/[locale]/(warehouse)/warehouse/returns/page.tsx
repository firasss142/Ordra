import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import { canScanWarehouse } from "@/lib/role-permissions";
import { ReturnsDesk } from "@/components/warehouse/desk/ReturnsDesk";
import { deskDates } from "@/lib/warehouse/desk-server";
import { ReturnsHome } from "@/components/warehouse/returns/ReturnsHome";

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

  // The console fetches its own queue and stats through SWR so a decision
  // refreshes both without a round trip through the server component.
  const { marketId, marketCode } = await getActiveMarketScope(user);

  // The agent scans first and decides on a sheet; the desk keeps its table.
  if (user.role === "warehouse_agent") return <ReturnsHome marketId={marketId} />;

  const { dateLabel, today } = deskDates(locale, marketId);
  return <ReturnsDesk market={marketCode === "ly" ? "ly" : "tn"} dateLabel={dateLabel} today={today} />;
}
