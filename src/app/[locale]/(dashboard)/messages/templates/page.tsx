import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { listMarketsFor, getDefaultMarketId } from "@/lib/markets/list";
import { TemplatesPageClient } from "./TemplatesPageClient";

export const dynamic = "force-dynamic";

/**
 * Clients › Messages › Modèles — the WhatsApp template registry.
 * Managers read their market; super_admin maps, resubmits and deletes in every
 * market. Reachable whether or not the market is connected — the page says
 * so. Agents never come here: the composer reads the approved list through
 * the API.
 */
export default async function WhatsAppTemplatesPage({ params }: { params: { locale: string } }) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (user.role !== "super_admin" && user.role !== "market_manager") redirect(`/${params.locale}/dashboard`);

  const markets = await listMarketsFor(user.role, user.market_id);
  return (
    <TemplatesPageClient
      user={user}
      markets={markets.map((m) => ({ id: m.id, name: m.name, code: m.code }))}
      initialMarketId={user.market_id ?? getDefaultMarketId(markets)}
      locale={params.locale}
    />
  );
}
