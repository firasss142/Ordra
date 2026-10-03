import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { legacyConnectionsTab } from "@/lib/reglages/topics";

/**
 * Old Système › Connexions. Its tabs became Réglages topics: Storefronts and
 * Correspondances → Boutiques, Transporteurs → Livraison, Services tiers →
 * WhatsApp. Kept as a redirect for bookmarks and deep links.
 */
export default async function ConnectionsRedirect({
  params,
  searchParams,
}: {
  params: { locale: string };
  searchParams: { tab?: string };
}) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  redirect(`/${params.locale}/system/settings/${legacyConnectionsTab(searchParams?.tab, user.role)}`);
}
