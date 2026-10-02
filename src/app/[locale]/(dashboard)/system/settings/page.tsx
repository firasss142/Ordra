import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { defaultTopic, legacySettingsTab } from "@/lib/reglages/topics";

/**
 * Système › Réglages. The page itself lives at /system/settings/[topic]; this
 * entry opens the role's first topic, or — for an old Paramètres link that
 * still carries ?tab= — the topic that tab became.
 */
export default async function ReglagesEntry({
  params,
  searchParams,
}: {
  params: { locale: string };
  searchParams: { tab?: string };
}) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (user.role !== "super_admin" && user.role !== "market_manager") {
    redirect(`/${params.locale}/dashboard`);
  }
  const topic = searchParams?.tab ? legacySettingsTab(searchParams.tab, user.role) : defaultTopic(user.role);
  redirect(`/${params.locale}/system/settings/${topic}`);
}
