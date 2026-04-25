import { redirect } from "next/navigation";
import { CarriersClient } from "./CarriersClient";
import { getServerUser } from "@/lib/auth/server-user";
import { listMarketsFor, getDefaultMarketId } from "@/lib/markets/list";

export default async function CarriersSettingsPage({
  params,
}: {
  params: { locale: string };
}) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);

  if (user.role !== "super_admin") {
    redirect(`/${params.locale}/dashboard`);
  }

  const initialMarkets = await listMarketsFor(user.role, user.market_id);
  const initialMarketId =
    user.market_id ?? getDefaultMarketId(initialMarkets);

  return (
    <CarriersClient
      user={user}
      initialMarkets={initialMarkets}
      initialMarketId={initialMarketId}
    />
  );
}
