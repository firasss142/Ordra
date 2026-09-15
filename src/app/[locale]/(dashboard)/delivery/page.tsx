import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { canUseDeliveryWorklist } from "@/lib/role-permissions";
import { DeliveryWorklistClient } from "@/components/delivery/DeliveryWorklistClient";
import { DeliveryBoardClient } from "@/components/delivery/DeliveryBoardClient";

export const dynamic = "force-dynamic";

/**
 * /delivery — « Suivi livraison ».
 *
 *   agent                        → their own parcels after upload: five
 *                                  buckets, one recommended move per row.
 *                                  Design: prototypes/suivi-livraison-v1.html.
 *   market_manager / super_admin → the board: the market's parcels, the agents
 *                                  strip, and a cockpit that judges each agent
 *                                  against the first-action target.
 *                                  Design: prototypes/suivi-livraison-manager-v1.html.
 *
 * Model: docs/delivery-worklist.md. Plan: plans/suivi-livraison.md phase 4.
 */
export default async function DeliveryPage({ params }: { params: { locale: string } }) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (!canUseDeliveryWorklist(user.role)) {
    redirect(user.role === "warehouse_agent" ? `/${params.locale}/warehouse` : `/${params.locale}/dashboard`);
  }
  const props = { role: user.role, viewerId: user.id, marketId: user.market_id, locale: params.locale };
  return user.role === "agent" ? <DeliveryWorklistClient {...props} /> : <DeliveryBoardClient {...props} />;
}
