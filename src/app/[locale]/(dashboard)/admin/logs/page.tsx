import { redirect } from "next/navigation";
import { LogsWorkspace } from "@/components/admin/LogsWorkspace";
import { getServerUser } from "@/lib/auth/server-user";

export default async function LogsPage({
  params,
}: {
  params: { locale: string };
}) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);

  if (user.role !== "super_admin") {
    redirect(`/${params.locale}/dashboard`);
  }

  return <LogsWorkspace user={user} />;
}
