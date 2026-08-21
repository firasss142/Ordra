import { redirect } from "next/navigation";
import { MarketsWorkspace } from "./MarketsWorkspace";
import { getServerUser } from "@/lib/auth/server-user";

/**
 * Système › Marchés. Read + edit (name/language/is_active; currency locked).
 * super_admin only — markets are the isolation root and editing one is a
 * cross-market action.
 */
export default async function SystemMarketsPage({
  params,
}: {
  params: { locale: string };
}) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (user.role !== "super_admin") redirect(`/${params.locale}/dashboard`);

  return <MarketsWorkspace user={user} />;
}
