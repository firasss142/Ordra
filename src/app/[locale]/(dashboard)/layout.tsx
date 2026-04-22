import { redirect } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { AgentDashboardShell } from "@/components/layout/AgentDashboardShell";
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

  const isRtl = user.direction === "rtl";

  if (user.role === "agent") {
    return <AgentDashboardShell user={user} />;
  }

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        backgroundColor: "var(--bg-page)",
        direction: isRtl ? "rtl" : "ltr",
      }}
    >
      <Sidebar user={user} />
      <main
        id="main-content"
        style={{
          flex: 1,
          marginInlineStart: "240px",
          minHeight: "100vh",
          backgroundColor: "var(--bg-page)",
        }}
      >
        {children}
      </main>
    </div>
  );
}
