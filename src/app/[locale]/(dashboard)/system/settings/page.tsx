import { redirect } from "next/navigation";
import { GeneralSettingsClient } from "../../settings/general/GeneralSettingsClient";
import { getServerUser } from "@/lib/auth/server-user";

/**
 * Système › Paramètres. The real home of the settings workspace; the old
 * /settings/general route redirects here. super_admin and market_manager both
 * edit their own market's settings (unchanged from the previous behaviour).
 */
export default async function SystemSettingsPage({
  params,
}: {
  params: { locale: string };
}) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);

  if (user.role !== "super_admin" && user.role !== "market_manager") {
    redirect(`/${params.locale}/dashboard`);
  }

  return <GeneralSettingsClient user={user} />;
}
