import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { defaultTopic, isTopicFor } from "@/lib/reglages/topics";
import { ReglagesShell } from "@/components/reglages/ReglagesShell";

/**
 * Réglages — one page, a menu of topics (plans/reglages-redesign.md,
 * prototypes/reglages-v2.html). super_admin sees every topic; a market_manager
 * sets the day-to-day rules of their own market and reads the rest.
 */
export default async function ReglagesTopicPage({
  params,
}: {
  params: { locale: string; topic: string };
}) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (user.role !== "super_admin" && user.role !== "market_manager") {
    redirect(`/${params.locale}/dashboard`);
  }
  if (!isTopicFor(user.role, params.topic)) {
    redirect(`/${params.locale}/system/settings/${defaultTopic(user.role)}`);
  }
  return <ReglagesShell user={user} topic={params.topic} />;
}
