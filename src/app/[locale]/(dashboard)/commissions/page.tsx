import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { marketIdToCode, marketTimezone } from "@/lib/markets";
import { canViewOwnCommissions } from "@/lib/role-permissions";
import { AgentCommissionsClient } from "@/components/agent-commissions/AgentCommissionsClient";

export const dynamic = "force-dynamic";

/**
 * /commissions — "Mes commissions", the agent's own read-only view. Managers
 * have the team pages for this; anyone else lands on their home.
 */
export default async function AgentCommissionsPage({ params }: { params: { locale: string } }) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (!canViewOwnCommissions(user.role)) {
    redirect(user.role === "super_admin" || user.role === "market_manager" ? `/${params.locale}/team/performance` : `/${params.locale}/dashboard`);
  }
  const marketId = user.market_id ?? "";
  return (
    <AgentCommissionsClient
      marketCode={(marketIdToCode(marketId) ?? "tn").toUpperCase()}
      locale={params.locale}
      tz={marketTimezone(marketId)}
    />
  );
}
