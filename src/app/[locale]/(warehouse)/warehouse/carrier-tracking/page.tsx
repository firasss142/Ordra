import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { canScanWarehouse } from "@/lib/role-permissions";
import { CarrierTrackingClient } from "@/components/warehouse/CarrierTrackingClient";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const user = await getServerUser();
  if (!user) redirect(`/${locale}/login`);
  if (!canScanWarehouse(user.role)) redirect(`/${locale}/queue`);
  if (user.role === "warehouse_agent") redirect(`/${locale}/warehouse/to-label`);

  return <CarrierTrackingClient user={user} />;
}
