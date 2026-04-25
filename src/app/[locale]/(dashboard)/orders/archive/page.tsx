import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAllActiveMarkets, getDefaultMarketId } from "@/lib/markets/list";
import { ArchivePageClient } from "./ArchivePageClient";
import type { Locale } from "@/types";

export const dynamic = "force-dynamic";

export default async function OrdersArchivePage({
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
  if (profile.role === "agent") redirect(`/${params.locale}/queue`);
  if (profile.role === "warehouse_agent") redirect(`/${params.locale}/warehouse`);

  const initialMarketId =
    profile.role === "market_manager"
      ? profile.market_id ?? ""
      : profile.role === "super_admin"
        ? getDefaultMarketId(await getAllActiveMarkets())
        : "";

  const marketLabel = profile.market_id
    ? (
        await supabase
          .from("markets")
          .select("name, currency")
          .eq("id", profile.market_id)
          .single()
      ).data
    : null;

  return (
    <ArchivePageClient
      role={profile.role}
      locale={params.locale as Locale}
      userMarketId={profile.market_id ?? ""}
      userMarketLabel={marketLabel?.name ?? ""}
      userMarketCurrency={marketLabel?.currency ?? "TND"}
      initialMarketId={initialMarketId}
    />
  );
}
