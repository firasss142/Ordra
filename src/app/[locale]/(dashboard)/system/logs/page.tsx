import { redirect } from "next/navigation";
import { JournalScreen } from "@/components/journal/JournalScreen";
import { getServerUser } from "@/lib/auth/server-user";

/** Système › Journaux — super_admin only (prototypes/journaux-v2.html). */
export default async function SystemLogsPage({
  params,
  searchParams,
}: {
  params: { locale: string };
  searchParams: { tab?: string };
}) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (user.role !== "super_admin") redirect(`/${params.locale}/dashboard`);
  // the server renders the view the URL asks for, so hydration agrees with it
  return <JournalScreen tab={searchParams.tab ?? null} />;
}
