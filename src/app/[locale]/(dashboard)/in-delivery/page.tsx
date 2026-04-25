import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { InDeliveryClient } from "./InDeliveryClient";

export const dynamic = "force-dynamic";

export default async function InDeliveryPage({
  params,
}: {
  params: { locale: string };
}) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (user.role === "agent") redirect(`/${params.locale}/queue`);
  if (user.role === "warehouse_agent") redirect(`/${params.locale}/warehouse`);

  return <InDeliveryClient user={user} />;
}
