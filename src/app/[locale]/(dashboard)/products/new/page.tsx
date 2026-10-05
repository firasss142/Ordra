import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { getActiveMarketScope } from "@/lib/auth/market-scope";
import { ProductCreateV6, type CreateMarket } from "@/components/products/v6/ProductCreateV6";

/*
 * NOUVEAU PRODUIT — the edit page's design (tabs, one save, the rail), for a
 * product that does not exist yet. Super admin only, as POST /api/products.
 * The market is the one the super admin is scoped to; scoped to all markets,
 * they choose it on the General tab. Amounts carry THAT market's currency,
 * never the locale's: the Libyan catalogue is authored in French.
 */
export default async function NewProductPage({
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
  if (profile.role !== "super_admin") redirect(`/${params.locale}/products`);

  const { data: marketsData } = await supabase
    .from("markets")
    .select("id, name, currency")
    .order("name", { ascending: true });
  const markets = (marketsData ?? []) as CreateMarket[];

  const activeScope = await getActiveMarketScope({
    role: profile.role,
    market_id: profile.market_id,
  } as Parameters<typeof getActiveMarketScope>[0]);
  const lockedMarketId = activeScope.marketId ?? null;

  return (
    <ProductCreateV6
      locale={params.locale}
      markets={markets}
      defaultMarketId={lockedMarketId ?? markets[0]?.id ?? ""}
      lockedMarketId={lockedMarketId}
    />
  );
}
