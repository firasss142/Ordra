import { redirect } from "next/navigation";
import { GeneralSettingsClient } from "./GeneralSettingsClient";
import { getServerUser } from "@/lib/auth/server-user";

export default async function GeneralSettingsPage({
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
