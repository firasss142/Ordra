import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { UsersPageClient } from "./UsersPageClient";

export default async function UsersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const user = await getServerUser();

  if (!user) redirect(`/${locale}/login`);
  if (user.role !== "super_admin" && user.role !== "market_manager") {
    redirect(`/${locale}/dashboard`);
  }

  return <UsersPageClient user={user} />;
}
