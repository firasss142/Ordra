import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { listMarketsFor } from "@/lib/markets/list";
import { StatusesSettingsClient } from "./StatusesSettingsClient";

export default async function StatusesSettingsPage({
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

  const preferred =
    initialMarkets.find((m) => m.code === "tn") ?? initialMarkets[0];
  const initialMarketId = user.market_id ?? preferred?.id ?? "";

  return (
    <StatusesSettingsClient
      user={user}
      initialMarkets={initialMarkets}
      initialMarketId={initialMarketId}
    />
  );
}
