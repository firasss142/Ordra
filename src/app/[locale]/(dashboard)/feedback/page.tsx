import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { canCaptureFeedback } from "@/lib/role-permissions";
import { AgentFeedbackSheet } from "@/components/feedback/AgentFeedbackSheet";
import { FeedbackWorkspace } from "@/components/feedback/manager/FeedbackWorkspace";

export const dynamic = "force-dynamic";

/**
 * /feedback — « Voix du client / صوت العميل ». Plan: plans/voix-du-client.md.
 *
 *   agent                        → « Mes retours »: their own entries, by category and moment
 *                                  (prototypes/voix-du-client-agent-v2.html, screen « mine »).
 *   market_manager / super_admin → the market's voice: volumes by category, top topics,
 *                                  entries per agent, the sheet and the « à valider » queue
 *                                  (prototypes/voix-du-client-manager-v6.html).
 */
export default async function FeedbackPage({ params }: { params: { locale: string } }) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (!canCaptureFeedback(user.role)) {
    redirect(user.role === "warehouse_agent" ? `/${params.locale}/warehouse` : `/${params.locale}/dashboard`);
  }
  return user.role === "agent"
    ? <AgentFeedbackSheet marketId={user.market_id} />
    : <FeedbackWorkspace role={user.role} marketId={user.market_id} locale={params.locale} />;
}
