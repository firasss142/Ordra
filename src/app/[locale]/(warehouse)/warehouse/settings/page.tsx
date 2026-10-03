import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import { canScanWarehouse } from "@/lib/role-permissions";
import { createClient } from "@/lib/supabase/server";
import { AgentSettings } from "@/components/warehouse/mobile/AgentSettings";
import { resolveSiteFilter } from "@/lib/warehouse/site-scope";

export const dynamic = "force-dynamic";

/**
 * Réglages — identity and sign-out for the agent shell.
 *
 * The mobile shell has no header (the mockups have none), so this is the only
 * place an agent can see who they are signed in as or get out.
 */
export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const user = await getServerUser();
  if (!user) redirect(`/${locale}/login`);
  if (!canScanWarehouse(user.role)) redirect(`/${locale}/queue`);

  const { marketId, marketCode } = await getActiveMarketScope(user);
  const supabase = await createClient();
  let marketName = "—";
  if (marketId) {
    const { data } = await supabase
      .from("markets")
      .select("name")
      .eq("id", marketId)
      .maybeSingle();
    if (data?.name) marketName = data.name;
  }

  // The prototype puts the agent's building under their name. A place name
  // painted on a wall: read in the market's language, never translated by key.
  const site = await resolveSiteFilter(supabase, { actor: user, requested: null });
  let siteName: string | null = null;
  if (site.warehouseId) {
    const { data } = await supabase
      .from("warehouses")
      .select("name_fr, name_ar")
      .eq("id", site.warehouseId)
      .maybeSingle<{ name_fr: string; name_ar: string }>();
    siteName = (marketCode === "ly" ? data?.name_ar : data?.name_fr) ?? null;
  }

  const code: "ly" | "tn" | null = marketCode === "ly" ? "ly" : marketCode === "tn" ? "tn" : null;
  return <AgentSettings user={user} marketName={marketName} marketCode={code} siteName={siteName} locale={locale} />;
}
