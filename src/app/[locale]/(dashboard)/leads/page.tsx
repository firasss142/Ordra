import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getServerUser } from "@/lib/auth/server-user";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import { getLeadsMetrics } from "@/lib/leads/metrics";
import { LeadsPageClient } from "./LeadsPageClient";
import type { Locale } from "@/types";

export const dynamic = "force-dynamic";

export default async function LeadsPage({
  params,
}: {
  params: { locale: string };
}) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);

  if (user.role === "agent") return null;
  if (user.role === "warehouse_agent") redirect(`/${params.locale}/warehouse`);

  const supabase = await createClient();
  let userMarketLabel = "";
  if (user.market_id) {
    const { data: market } = await supabase
      .from("markets")
      .select("name")
      .eq("id", user.market_id)
      .single();
    if (market) userMarketLabel = market.name;
  }

  const { marketId: activeMarketId } = await getActiveMarketScope(user);
  // Leads metrics prefetch uses scope marketId directly (null = all markets for super_admin).
  const initialMetrics = await getLeadsMetrics(supabase, {
    marketId: activeMarketId,
  });

  return (
    <LeadsPageClient
      role={user.role}
      userMarketId={user.market_id ?? ""}
      userMarketLabel={userMarketLabel}
      locale={params.locale as Locale}
      initialMetrics={initialMetrics}
    />
  );
}
