import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { ProspectsClient } from "@/components/prospects/ProspectsClient";
import { ProspectsConsoleClient } from "@/components/prospects/ProspectsConsoleClient";

export const dynamic = "force-dynamic";

/**
 * /leads — « Prospects », rebuilt from prototypes/prospects-v3.html.
 *
 *   agent                        → the worklist: six derived buckets, one
 *                                  recommended move per row, the call outcome
 *                                  in one sheet.
 *   market_manager / super_admin → the console: four KPIs, the pipeline table,
 *                                  campaign funnels and the agent roster.
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
    return (
      <ProspectsClient
        role={user.role}
        viewerId={user.id}
        marketId={user.market_id ?? null}
        locale={params.locale}
      />
    );
  }

  return (
    <ProspectsConsoleClient
      role={user.role}
      marketId={user.market_id ?? null}
      locale={params.locale}
    />
  );
}
