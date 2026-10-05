import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { AgentCrmPage } from "@/components/agent/crm/AgentCrmPage";
import { ConsoleClient } from "@/components/prospects/console/ConsoleClient";

export const dynamic = "force-dynamic";

/**
 * /leads — « Prospects », rebuilt from prototypes/prospects-v3.html.
 *
 *   agent                        → « Prospects » in the agent shell
 *                                  (components/agent/crm, prototypes/agent-shell-v2.html
 *                                  §3): seven tiles over the six derived buckets, the
 *                                  call result inside the prospect, « Nouveau prospect ».
 *   market_manager / super_admin → the console: four views on one route —
 *                                  Vue d'ensemble, Prospects, Campagnes,
 *                                  Équipe — with bulk distribution, the
 *                                  campaign builder and the WhatsApp channel.
 *
 * The old kanban (LeadsPageClient, LeadsKanban, LeadsTable) is no longer
 * mounted here. It is untouched on disk, and the campaign builder it opened
 * still lives in components/crm/ProspectCampaignPanel — the console's
 * "Nouvelle campagne" is where that reappears once it is rebuilt.
 *
 * Model: docs/prospects-worklist.md.
 */
export default async function LeadsPage({ params }: { params: { locale: string } }) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (user.role === "warehouse_agent") redirect(`/${params.locale}/warehouse`);
  if (user.role === "investor") redirect(`/${params.locale}/investor`);

  if (user.role === "agent") {
    return <AgentCrmPage marketId={user.market_id ?? null} locale={params.locale} />;
  }

  return (
    <ConsoleClient
      role={user.role}
      marketId={user.market_id ?? null}
      locale={params.locale}
    />
  );
}
