import { redirect } from "next/navigation";
import { AgentDashboardShell } from "@/components/layout/AgentDashboardShell";
import { DashboardChrome } from "@/components/layout/DashboardChrome";
import { getServerUser } from "@/lib/auth/server-user";

export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  const user = await getServerUser();
  if (!user) {
    redirect(`/${params.locale}/login`);
  }

  if (user.role === "agent") {
    return <AgentDashboardShell user={user}>{children}</AgentDashboardShell>;
  }

  return <DashboardChrome user={user}>{children}</DashboardChrome>;
}
