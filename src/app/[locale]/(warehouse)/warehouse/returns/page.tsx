import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import { canScanWarehouse } from "@/lib/role-permissions";
import { ReturnsConsole } from "@/components/warehouse/console/ReturnsConsole";

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
  const { marketId } = await getActiveMarketScope(user);

  return <ReturnsConsole marketId={marketId} />;
}
