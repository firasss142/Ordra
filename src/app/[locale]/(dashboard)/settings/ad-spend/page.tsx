import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { canViewProfitability } from "@/lib/role-permissions";
import { listMarketsFor } from "@/lib/markets/list";
import { AdSpendClient } from "./AdSpendClient";

export default async function AdSpendPage({
  params,
}: {
  params: { locale: string };
}) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (!canViewProfitability(user.role)) redirect(`/${params.locale}/dashboard`);

  const markets = await listMarketsFor(user.role, user.market_id);

  return <AdSpendClient user={user} markets={markets} />;
}
