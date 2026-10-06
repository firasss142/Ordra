import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { ProspectDetailClient } from "@/components/prospects/detail/ProspectDetailClient";

export const dynamic = "force-dynamic";

/**
 * /leads/[id] — one prospect.
 *
 *   agent   → the prospect page: the agent shell's « Convertir » lands here
 *             with ?convert=1 (AgentCrmPage), so the conversion flow lives on.
 *   manager → the desk (since 2026-10-06 a prospect opens in a drawer on
 *             /leads): /leads?open=<id>. Notifications and Messages link here.
 */
export default async function ProspectDetailPage({
  params, searchParams,
}: { params: { locale: string; id: string }; searchParams?: { convert?: string } }) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (user.role === "warehouse_agent") redirect(`/${params.locale}/warehouse`);
  if (user.role === "investor") redirect(`/${params.locale}/investor`);
  if (user.role !== "agent") redirect(`/${params.locale}/leads?open=${encodeURIComponent(params.id)}`);

  return <ProspectDetailClient leadId={params.id} locale={params.locale} openConvert={searchParams?.convert === "1"} />;
}
