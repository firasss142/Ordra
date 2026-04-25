import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAllActiveMarkets, getDefaultMarketId } from "@/lib/markets/list";
import { getFollowUpsSummary } from "@/lib/follow-ups/summary";
import { getFollowUpsKanbanInitial, getFollowUpsPage } from "@/lib/follow-ups/list";
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

  let superAdminInitialMarketId = "";
  if (profile.role === "super_admin") {
    superAdminInitialMarketId = getDefaultMarketId(await getAllActiveMarkets());
  }

  const scopedMarketId =
    profile.role === "super_admin"
      ? (superAdminInitialMarketId || null)
      : (profile.market_id ?? null);

  const isAgent = profile.role === "agent";

  // Agents only get the timeline view (own queue). Managers/super_admin get both.
  const [initialSummary, initialColumnPages, initialTimelinePage] = await Promise.all([
    isAgent
      ? Promise.resolve({ open: 0, in_progress: 0, resolved: 0, escalated: 0, total: 0 })
      : getFollowUpsSummary(supabase, {
          marketId: scopedMarketId,
          agentId: null,
          campaignId: null,
        }),
    isAgent
      ? Promise.resolve({
          open: { rows: [], nextCursor: null },
          in_progress: { rows: [], nextCursor: null },
          resolved: { rows: [], nextCursor: null },
          escalated: { rows: [], nextCursor: null },
        })
      : getFollowUpsKanbanInitial(supabase, {
          marketId: scopedMarketId,
          agentId: null,
          campaignId: null,
        }),
    getFollowUpsPage(supabase, {
      marketId: scopedMarketId,
      agentId: isAgent ? authUser.id : null,
      campaignId: null,
      sortByDue: true,
      limit: 25,
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
      initialMarketId={superAdminInitialMarketId}
      initialTimelinePage={initialTimelinePage}
      initialAgentId={isAgent ? authUser.id : null}
    />
  );
}
