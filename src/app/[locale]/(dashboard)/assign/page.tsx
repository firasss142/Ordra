import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AssignPageClient } from "./AssignPageClient";
import { canAssignOrders } from "@/lib/order-permissions";
import { getServerUser } from "@/lib/auth/server-user";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import type { Locale } from "@/types";

export const dynamic = "force-dynamic";

export default async function AssignPage({
  params,
}: {
  params: { locale: string };
}) {
  const user = await getServerUser();
  if (!user) redirect(`/${params.locale}/login`);

  const { marketId: scopedMarketId } = await getActiveMarketScope(user);
  const marketIdParam = scopedMarketId ?? "all";
  const actorMarketId = user.market_id ?? "";

  if (!canAssignOrders(user.role, marketIdParam, actorMarketId)) {
    if (user.role === "agent") redirect(`/${params.locale}/queue`);
    if (user.role === "warehouse_agent") redirect(`/${params.locale}/warehouse`);
    redirect(`/${params.locale}/login`);
  }

  const supabase = await createClient();
  const { data: market } = scopedMarketId
    ? await supabase.from("markets").select("code, currency").eq("id", scopedMarketId).single()
    : { data: null };

  const marketCode = market?.code ?? "TN";

  return (
    <AssignPageClient
      role={user.role}
      marketId={marketIdParam}
      marketCode={marketCode}
      locale={params.locale as Locale}
    />
  );
}
