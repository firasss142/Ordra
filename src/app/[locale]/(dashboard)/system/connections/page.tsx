import { redirect } from "next/navigation";
import { ConnectionsClient } from "./ConnectionsClient";
import { getServerUser } from "@/lib/auth/server-user";
import { listMarketsFor } from "@/lib/markets/list";

/**
 * Système › Connexions. Storefronts, carriers, third-party services and
 * mappings in one tabbed workspace. super_admin manages everything;
 * market_manager sees their own market read-only (mutations gated in the API).
 */
export default async function SystemConnectionsPage({
  params,
}: {
  params: { locale: string };
}) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);

  if (user.role !== "super_admin" && user.role !== "market_manager") {
    redirect(`/${params.locale}/dashboard`);
  }

  const readOnly = user.role !== "super_admin";
  const markets = await listMarketsFor(user.role, user.market_id);
  return <ConnectionsClient user={user} readOnly={readOnly} markets={markets} />;
}
