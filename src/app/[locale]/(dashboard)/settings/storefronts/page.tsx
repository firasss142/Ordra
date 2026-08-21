import { redirect } from "next/navigation";

/**
 * Legacy route — storefronts moved into the Connexions workspace in the Système
 * redesign. (The StorefrontsSection component is still used by the Marchés
 * drawer, so it is kept; only this standalone route redirects.)
 */
export default function StorefrontsSettingsPage({
  params,
}: {
  params: { locale: string };
}) {
  redirect(`/${params.locale}/system/connections?tab=storefronts`);
}
