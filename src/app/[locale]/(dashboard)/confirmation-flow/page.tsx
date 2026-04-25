import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { getAllActiveMarkets, getDefaultMarketId } from "@/lib/markets/list";
import { ConfirmationFlowWorkspace } from "@/components/confirmation-flow/ConfirmationFlowWorkspace";

export const dynamic = "force-dynamic";

export default async function ConfirmationFlowPage({
  params,
}: {
  params: { locale: string };
}) {
  const user = await getServerUser();

  if (!user) redirect(`/${params.locale}/login`);
  if (user.role === "agent") redirect(`/${params.locale}/queue`);

  const marketId =
    user.role === "super_admin"
      ? getDefaultMarketId(await getAllActiveMarkets())
      : (user.market_id ?? null);

  return (
    <ConfirmationFlowWorkspace
      role={user.role}
      marketId={marketId}
    />
  );
}
