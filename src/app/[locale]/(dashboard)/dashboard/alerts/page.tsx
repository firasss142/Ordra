import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { AlertsClient } from "./AlertsClient";

export default async function AlertsPage({
  params,
}: {
  params: { locale: string };
}) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (user.role === "agent" || user.role === "warehouse_agent") {
    redirect(`/${params.locale}/queue`);
  }
  return <AlertsClient user={user} />;
}
