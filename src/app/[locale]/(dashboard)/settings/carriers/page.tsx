import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";

/**
 * Ancien écran Transporteurs — replié dans Système → Connexions.
 *
 * WHY. Il existait deux surfaces super_admin pour la même chose : celle-ci
 * (CarriersSection) et l'onglet Transporteurs de Connexions (CarriersPanel),
 * chacune avec son propre interrupteur actif/inactif. Deux écrans pour un même
 * réglage, c'est deux endroits où chercher et un endroit de trop pour se
 * tromper. Connexions gagne : c'est là que vivent déjà storefronts, services et
 * correspondances, et c'est là que sont arrivées les préférences de commande et
 * les sites d'entrepôt.
 *
 * La route est conservée en redirection plutôt que supprimée : des liens et des
 * signets pointent dessus, et dans ce projet une page absente de la navigation
 * n'est pas une page morte.
 */
export default async function CarriersSettingsPage({
  params,
}: {
  params: { locale: string };
}) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);

  if (user.role !== "super_admin") {
    redirect(`/${params.locale}/dashboard`);
  }

  redirect(`/${params.locale}/system/connections?tab=carriers`);
}
