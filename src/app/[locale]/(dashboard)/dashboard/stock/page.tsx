import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { InventoryClient } from "./InventoryClient";

export default async function InventoryPage({
  params,
}: {
  params: { locale: string };
}) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (user.role === "agent" || user.role === "warehouse_agent") {
    redirect(`/${params.locale}/queue`);
  }
  return <InventoryClient user={user} />;
}
