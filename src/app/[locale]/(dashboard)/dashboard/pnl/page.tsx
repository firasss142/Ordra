import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { getAllActiveMarkets, getDefaultMarketId } from "@/lib/markets/list";
import { ProfitabilityClient } from "./ProfitabilityClient";

export const dynamic = "force-dynamic";

export default async function ProfitabilityPage({
  params,
}: {
  params: { locale: string };
}) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (user.role === "agent" || user.role === "warehouse_agent") {
    redirect(`/${params.locale}/queue`);
  }

  const markets = user.role === "super_admin" ? await getAllActiveMarkets() : [];
  const defaultMarketId = getDefaultMarketId(markets);
  const initialMarketId =
    user.role === "super_admin" ? defaultMarketId : user.market_id ?? "";

  return (
    <ProfitabilityClient
      user={user}
      markets={markets}
      initialMarketId={initialMarketId}
    />
  );
}
