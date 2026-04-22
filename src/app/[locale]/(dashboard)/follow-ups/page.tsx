import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getFollowUpsSummary } from "@/lib/follow-ups/summary";
import { getFollowUpsKanbanInitial } from "@/lib/follow-ups/list";
import { FollowUpsPageClient } from "./FollowUpsPageClient";
import type { Locale } from "@/types";

export const dynamic = "force-dynamic";

export default async function FollowUpsPage({
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

  // Agents render via AgentTabsContainer at layout level; the page itself is
  // a no-op so we don't double-mount FollowUpsBoard.
  if (profile.role === "agent") return null;
  if (profile.role === "warehouse_agent") redirect(`/${params.locale}/warehouse`);

  let userMarketLabel = "";
  if (profile.market_id) {
    const { data: market } = await supabase
      .from("markets")
      .select("name, code")
      .eq("id", profile.market_id)
      .single();
    if (market) userMarketLabel = market.name;
  }

  const marketCode: "TN" | "LY" = params.locale === "ar" ? "LY" : "TN";

  const scopedMarketId =
    profile.role === "super_admin" ? null : (profile.market_id ?? null);

  // Parallel prefetch: KPI summary + four Kanban columns (4×25 rows) in a
  // single round-trip batch. The client receives fully populated SWR caches
  // for the initial key and paints with zero loading state.
  const [initialSummary, initialColumnPages] = await Promise.all([
    getFollowUpsSummary(supabase, {
      marketId: scopedMarketId,
      agentId: null,
      campaignId: null,
    }),
    getFollowUpsKanbanInitial(supabase, {
      marketId: scopedMarketId,
      agentId: null,
      campaignId: null,
    }),
  ]);

  return (
    <FollowUpsPageClient
      role={profile.role}
      userMarketId={profile.market_id ?? ""}
      userMarketLabel={userMarketLabel}
      locale={params.locale as Locale}
      marketCode={marketCode}
      initialSummary={initialSummary}
      initialColumnPages={initialColumnPages}
    />
  );
}
