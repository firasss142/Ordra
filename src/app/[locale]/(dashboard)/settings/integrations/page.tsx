import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { listMarketsFor } from "@/lib/markets/list";
import { IntegrationsClient } from "./IntegrationsClient";

/**
 * Credentials for the platforms the OMS reads from.
 *
 * Super-admin only, and not because of the data — because of the credential. A
 * Meta System User token can read every figure in an ad account, and this is
 * the only page in the product where one is entered.
 */
export default async function IntegrationsSettingsPage({
  params,
}: {
  params: { locale: string };
}) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (user.role !== "super_admin") redirect(`/${params.locale}/dashboard`);

  const markets = await listMarketsFor(user.role, user.market_id);

  return <IntegrationsClient user={user} markets={markets} />;
}
