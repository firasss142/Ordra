import { redirect } from "next/navigation";
import { GeneralSettingsClient } from "./GeneralSettingsClient";
import { getServerUser } from "@/lib/auth/server-user";
import { listMarketsFor, getDefaultMarketId } from "@/lib/markets/list";

export default async function GeneralSettingsPage({
  params,
}: {
  params: { locale: string };
}) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);

  if (user.role !== "super_admin" && user.role !== "market_manager") {
    redirect(`/${params.locale}/dashboard`);
  }

  const initialMarkets =
    user.role === "super_admin"
      ? await listMarketsFor(user.role, user.market_id)
      : [];

  const initialMarketId =
    user.market_id ?? getDefaultMarketId(initialMarkets);

  return (
    <GeneralSettingsClient
      user={user}
      initialMarkets={initialMarkets}
      initialMarketId={initialMarketId}
    />
  );
}
