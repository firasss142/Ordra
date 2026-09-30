import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { MessagesPageClient } from "./MessagesPageClient";

export const dynamic = "force-dynamic";

/** Clients › Messages — the WhatsApp orphan inbox (managers + super_admin). */
export default async function MessagesPage({ params }: { params: { locale: string } }) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (user.role !== "super_admin" && user.role !== "market_manager") redirect(`/${params.locale}/dashboard`);
  return <MessagesPageClient user={user} locale={params.locale} />;
}
