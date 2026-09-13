import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { canUseDeliveryWorklist } from "@/lib/role-permissions";
import { DeliveryWorklistClient } from "@/components/delivery/DeliveryWorklistClient";

export const dynamic = "force-dynamic";

/**
 * /delivery — « Suivi livraison ». Agents work their own parcels after upload;
 * managers and super_admin see the market. Design:
 * prototypes/suivi-livraison-v1.html (v3). Model: docs/delivery-worklist.md.
 */
export default async function DeliveryPage({ params }: { params: { locale: string } }) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (!canUseDeliveryWorklist(user.role)) {
    redirect(user.role === "warehouse_agent" ? `/${params.locale}/warehouse` : `/${params.locale}/dashboard`);
  }
  return <DeliveryWorklistClient role={user.role} viewerId={user.id} marketId={user.market_id} locale={params.locale} />;
}
