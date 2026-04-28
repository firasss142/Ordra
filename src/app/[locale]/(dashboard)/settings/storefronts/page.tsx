import { redirect } from "next/navigation";
import { StorefrontsClient } from "./StorefrontsClient";
import { getServerUser } from "@/lib/auth/server-user";

export default async function StorefrontsSettingsPage({
  params,
}: {
  params: { locale: string };
}) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);

  if (user.role !== "super_admin" && user.role !== "market_manager") {
    redirect(`/${params.locale}/dashboard`);
  }

  return <StorefrontsClient user={user} />;
}
