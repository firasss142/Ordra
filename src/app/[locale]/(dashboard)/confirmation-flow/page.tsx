import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
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

  const { marketId: scopedMarketId } = await getActiveMarketScope(user);
  // confirmation-flow requires a single market — when super_admin picks "all",
  // fall back to the default active market so the page can render.
  const marketId =
    scopedMarketId ?? getDefaultMarketId(await getAllActiveMarkets());

  return (
    <ConfirmationFlowWorkspace
      role={user.role}
      marketId={marketId}
    />
  );
}
