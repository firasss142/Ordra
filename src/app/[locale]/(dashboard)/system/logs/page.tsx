import { redirect } from "next/navigation";
import { JournauxWorkspace } from "@/components/journaux/JournauxWorkspace";
import { getServerUser } from "@/lib/auth/server-user";

/** Système › Journaux — super_admin only. */
export default async function SystemLogsPage({ params }: { params: { locale: string } }) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (user.role !== "super_admin") redirect(`/${params.locale}/dashboard`);
  return <JournauxWorkspace />;
}
