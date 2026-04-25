import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AssignPageClient } from "./AssignPageClient";
import { canAssignOrders } from "@/lib/order-permissions";
import type { Locale, Role } from "@/types";

export const dynamic = "force-dynamic";

export default async function AssignPage({
  params,
}: {
  params: { locale: string };
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(`/${params.locale}/login`);

  const { data: profile } = await supabase
    .from("users")
    .select("role, market_id")
    .eq("id", user.id)
    .single();

  if (!profile) redirect(`/${params.locale}/login`);

  const role = profile.role as Role;
  const actorMarketId = profile.market_id ?? "";
  const marketId = role === "super_admin" ? (actorMarketId || "all") : actorMarketId;

  if (!canAssignOrders(role, marketId, actorMarketId)) {
    if (role === "agent") redirect(`/${params.locale}/queue`);
    if (role === "warehouse_agent") redirect(`/${params.locale}/warehouse`);
    redirect(`/${params.locale}/login`);
  }

  const { data: market } = marketId && marketId !== "all"
    ? await supabase.from("markets").select("code, currency").eq("id", marketId).single()
    : { data: null };

  const marketCode = market?.code ?? "TN";

  return (
    <AssignPageClient
      role={role}
      marketId={marketId}
      marketCode={marketCode}
      locale={params.locale as Locale}
    />
  );
}
