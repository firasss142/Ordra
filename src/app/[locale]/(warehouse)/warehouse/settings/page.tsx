import { redirect } from "next/navigation";
import { getServerUser } from "@/lib/auth/server-user";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import { canScanWarehouse } from "@/lib/role-permissions";
import { createClient } from "@/lib/supabase/server";
import { AgentSettings } from "@/components/warehouse/mobile/AgentSettings";

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

  const { marketId } = await getActiveMarketScope(user);
  let marketName = "—";
  if (marketId) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("markets")
      .select("name")
      .eq("id", marketId)
      .maybeSingle();
    if (data?.name) marketName = data.name;
  }

  return <AgentSettings user={user} marketName={marketName} />;
}
