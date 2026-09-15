import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { ProspectDetailClient } from "@/components/prospects/detail/ProspectDetailClient";

export const dynamic = "force-dynamic";

/**
 * /leads/[id] — one prospect, on its own page.
 *
 * Rebuilt on 2026-09-15 in the console's visual language. The page it
 * replaced was the last screen still wearing the pre-2026 CRM look: inline
 * styles, its own grey shell, raw status transitions in the history.
 *
 * Every role that can reach « Prospects » gets every action here — log an
 * attempt, qualify, schedule a callback, convert, close, archive. The server
 * still decides what it will accept.
 */
export default async function ProspectDetailPage({
  params,
}: { params: { locale: string; id: string } }) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (user.role === "warehouse_agent") redirect(`/${params.locale}/warehouse`);
  if (user.role === "investor") redirect(`/${params.locale}/investor`);

  return <ProspectDetailClient leadId={params.id} locale={params.locale} />;
}
