import { redirect } from "next/navigation";
import { JournalScreen } from "@/components/journal/JournalScreen";
import { getServerUser } from "@/lib/auth/server-user";

/** Système › Journaux — super_admin only (prototypes/journaux-v2.html). */
export default async function SystemLogsPage({ params }: { params: { locale: string } }) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (user.role !== "super_admin") redirect(`/${params.locale}/dashboard`);
  return <JournalScreen />;
}
