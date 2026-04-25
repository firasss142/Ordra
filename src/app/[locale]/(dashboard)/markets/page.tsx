import { redirect } from "next/navigation";
import { MarketsClient } from "./MarketsClient";
import { getServerUser } from "@/lib/auth/server-user";

export default async function MarketsPage({
  params,
}: {
  params: { locale: string };
}) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);

  if (user.role !== "super_admin") {
    redirect(`/${params.locale}/dashboard`);
  }

  return <MarketsClient user={user} />;
}
