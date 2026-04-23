import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAllActiveMarkets, getDefaultMarketId } from "@/lib/markets/list";
import { getLeadsMetrics } from "@/lib/leads/metrics";
import { LeadsPageClient } from "./LeadsPageClient";
import type { Locale } from "@/types";

export const dynamic = "force-dynamic";

export default async function LeadsPage({
  params,
}: {
  params: { locale: string };
}) {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) redirect(`/${params.locale}/login`);

  const { data: profile } = await supabase
    .from("users")
    .select("role, market_id")
    .eq("id", authUser.id)
    .single();

  if (!profile) redirect(`/${params.locale}/login`);

  // Agents render the board via AgentTabsContainer in the dashboard layout —
  // return null here to avoid double-mount.
  if (profile.role === "agent") return null;
  if (profile.role === "warehouse_agent") redirect(`/${params.locale}/warehouse`);

  let userMarketLabel = "";
  if (profile.market_id) {
    const { data: market } = await supabase
      .from("markets")
      .select("name")
      .eq("id", profile.market_id)
      .single();
    if (market) userMarketLabel = market.name;
  }

  let superAdminInitialMarketId = "";
  if (profile.role === "super_admin") {
    superAdminInitialMarketId = getDefaultMarketId(await getAllActiveMarkets());
  }

  const scopedMarketId =
    profile.role === "super_admin"
      ? (superAdminInitialMarketId || null)
      : (profile.market_id ?? null);

  const initialMetrics = await getLeadsMetrics(supabase, {
    marketId: scopedMarketId,
  });

  return (
    <LeadsPageClient
      role={profile.role}
      userMarketId={profile.market_id ?? ""}
      userMarketLabel={userMarketLabel}
      locale={params.locale as Locale}
      initialMetrics={initialMetrics}
      initialMarketId={superAdminInitialMarketId}
    />
  );
}
