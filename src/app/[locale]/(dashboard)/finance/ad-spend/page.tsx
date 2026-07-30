import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { canViewFinanceSection } from "@/lib/finance-permissions";
import { listMarketsFor, getDefaultMarketId } from "@/lib/markets/list";
import { AdSpendClient } from "./AdSpendClient";

export default async function AdSpendPage({
  params,
}: {
  params: { locale: string };
}) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (!canViewFinanceSection(user.role)) redirect(`/${params.locale}/dashboard`);

  const markets = await listMarketsFor(user.role, user.market_id);
  const initialMarketId =
    user.role === "super_admin" ? getDefaultMarketId(markets) : (user.market_id ?? "");

  return <AdSpendClient user={user} markets={markets} initialMarketId={initialMarketId} />;
}
