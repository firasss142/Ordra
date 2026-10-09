import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { AgentCrmPage } from "@/components/agent/crm/AgentCrmPage";
import { DeskClient } from "@/components/prospects/desk/DeskClient";

export const dynamic = "force-dynamic";

/**
 * /leads — « Prospects ».
 *
 *   agent                        → « Prospects » in the agent shell (components/agent/crm).
 *   market_manager / super_admin → the desk: « récupérer les ventes perdues ».
 *     One page — the band (what came back this month + À faire), one card per
 *     source, one card per agent, the list — with « Nouvelle liste », « Règles »
 *     and the export. prototypes/prospects-manager-v5.html, plans/prospects-recovery.md.
 *
 * `?open=<lead id>` is where the old /leads/[id] page now lands for managers.
 */
export default async function LeadsPage({ params, searchParams }: { params: { locale: string }; searchParams?: { open?: string } }) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (user.role === "warehouse_agent") redirect(`/${params.locale}/warehouse`);
  if (user.role === "investor") redirect(`/${params.locale}/investor`);

  if (user.role === "agent") {
    return <AgentCrmPage marketId={user.market_id ?? null} locale={params.locale} />;
  }

  return <DeskClient role={user.role} marketId={user.market_id ?? null} locale={params.locale} openId={searchParams?.open ?? null} />;
}
