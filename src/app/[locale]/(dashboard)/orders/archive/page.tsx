import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/auth/server-user";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import { getAllActiveMarkets, getDefaultMarketId } from "@/lib/markets/list";
import { todayInMarket } from "@/lib/dates/market-day";
import { ArchivePage } from "@/components/orders/commandes/ArchivePage";
import type { Locale } from "@/types";

export const dynamic = "force-dynamic";

export default async function OrdersArchivePage({ params }: { params: { locale: string } }) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (user.role === "agent") redirect(`/${params.locale}/queue`);
  if (user.role === "warehouse_agent") redirect(`/${params.locale}/warehouse`);

  const { marketId: scopedMarketId } = await getActiveMarketScope(user);
  const marketId = scopedMarketId ?? (user.role === "super_admin" ? getDefaultMarketId(await getAllActiveMarkets()) : null);

  const supabase = await createClient();
  const [marketLabel, first] = await Promise.all([
    user.market_id
      ? supabase.from("markets").select("name, currency").eq("id", user.market_id).single().then((r) => r.data)
      : Promise.resolve(null),
    marketId
      ? supabase.from("orders").select("created_at").eq("market_id", marketId).order("created_at", { ascending: true }).limit(1).maybeSingle().then((r) => r.data as { created_at: string } | null)
      : Promise.resolve(null),
  ]);

  return (
    <ArchivePage
      role={user.role}
      userId={user.id}
      locale={params.locale as Locale}
      userMarketId={user.market_id ?? ""}
      userMarketLabel={marketLabel?.name ?? ""}
      userMarketCurrency={marketLabel?.currency ?? "TND"}
      firstOrderDay={first?.created_at ? todayInMarket(marketId, new Date(first.created_at)) : null}
    />
  );
}
