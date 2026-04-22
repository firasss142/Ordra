import { redirect } from "next/navigation";
import { SettingsClient } from "./SettingsClient";
import { getServerUser } from "@/lib/auth/server-user";
import { listMarketsFor } from "@/lib/markets/list";

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: { locale: string };
  searchParams: { section?: string };
}) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);

  const section = searchParams.section ?? "general";
  const initialMarkets =
    user.role === "super_admin"
      ? await listMarketsFor(user.role, user.market_id)
      : [];

  const preferred =
    initialMarkets.find((m) => m.code === "tn") ?? initialMarkets[0];
  const initialMarketId =
    user.market_id ?? preferred?.id ?? "";

  return (
    <SettingsClient
      user={user}
      section={section}
      initialMarkets={initialMarkets}
      initialMarketId={initialMarketId}
    />
  );
}
