import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/auth/server-user";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import { getAllActiveMarkets, getDefaultMarketId } from "@/lib/markets/list";
import { DuplicatesPageClient } from "@/components/orders/duplicates/DuplicatesPageClient";
import type { Locale } from "@/types";

export const dynamic = "force-dynamic";

/**
 * Commandes → Doublons.
 *
 * Unlike the other pages in this folder, agents are NOT redirected away: they
 * get the screen read-only, so a duplicate can be spotted before the customer
 * is called. Every delete affordance is hidden for them, and the bulk route
 * refuses them on its own — the read-only UI is a courtesy, not the gate.
 */
export default async function OrdersDuplicatesPage({
  params,
}: {
  params: { locale: string };
}) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (user.role === "warehouse_agent") redirect(`/${params.locale}/warehouse`);

  const { marketId: scopedMarketId } = await getActiveMarketScope(user);
  const initialMarketId =
    scopedMarketId ??
    (user.role === "super_admin" ? getDefaultMarketId(await getAllActiveMarkets()) : "");

  const supabase = await createClient();
  const marketLabel = user.market_id
    ? (
        await supabase
          .from("markets")
          .select("name, currency")
          .eq("id", user.market_id)
          .single()
      ).data
    : null;

  return (
    <DuplicatesPageClient
      role={user.role}
      locale={params.locale as Locale}
      userMarketId={user.market_id ?? ""}
      initialMarketId={initialMarketId}
      currencyCode={marketLabel?.currency ?? "TND"}
    />
  );
}
