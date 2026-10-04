import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import { getAllActiveMarkets, getDefaultMarketId } from "@/lib/markets/list";

/**
 * Who may open Transporteurs and on which market: the owner (scoped market,
 * else the default) and market managers (their own). Everyone else is sent
 * home — the middleware already does it; this keeps the page safe on its own.
 */
export async function resolveScorecardPage(locale: string): Promise<{ marketId: string; marketCode: string }> {
  const user = await getServerUser();
  if (!user) redirect(`/${locale}/login`);
  if (user.role === "agent") redirect(`/${locale}/queue`);
  if (user.role === "warehouse_agent") redirect(`/${locale}/warehouse`);
  if (user.role !== "super_admin" && user.role !== "market_manager") redirect(`/${locale}`);

  const markets = await getAllActiveMarkets();
  const { marketId: scoped } = await getActiveMarketScope(user);
  const marketId = (user.role === "super_admin" ? scoped : user.market_id) ?? getDefaultMarketId(markets);
  const marketCode = markets.find((m) => m.id === marketId)?.code ?? "";
  return { marketId, marketCode };
}
