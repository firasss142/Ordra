import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/auth/server-user";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import { getAllActiveMarkets, getDefaultMarketId } from "@/lib/markets/list";
import { ArchivePageClient } from "./ArchivePageClient";
import type { Locale } from "@/types";

export const dynamic = "force-dynamic";

export default async function OrdersArchivePage({
  params,
}: {
  params: { locale: string };
}) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);
  if (user.role === "agent") redirect(`/${params.locale}/queue`);
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
    <ArchivePageClient
      role={user.role}
      locale={params.locale as Locale}
      userMarketId={user.market_id ?? ""}
      userMarketLabel={marketLabel?.name ?? ""}
      userMarketCurrency={marketLabel?.currency ?? "TND"}
      initialMarketId={initialMarketId}
    />
  );
}
