import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ProductCreateForm } from "@/components/products/ProductCreateForm";
import { getActiveMarketScope } from "@/lib/auth/market-scope";

interface Market {
  id: string;
  name: string;
  currency: string | null;
}

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

  if (profile.role !== "super_admin") {
    redirect(`/${params.locale}/products`);
  }

  const { data: marketsData } = await supabase
    .from("markets")
    .select("id, name, currency")
    .order("name", { ascending: true });

  const markets: Market[] = (marketsData ?? []) as Market[];

  const activeScope = await getActiveMarketScope({
    role: profile.role,
    market_id: profile.market_id,
  } as Parameters<typeof getActiveMarketScope>[0]);
  const lockedMarketId = activeScope.marketId;
  const defaultMarketId = lockedMarketId ?? markets[0]?.id ?? "";

  // Le symbole vient du marché visé, jamais de la locale : un super admin
  // saisit le catalogue libyen en français. Marché inconnu → montants nus.
  const currency = markets.find((m) => m.id === defaultMarketId)?.currency;
  const currencySymbol =
    currency === "LYD" ? "\u062f.\u0644" : currency === "TND" ? "DT" : undefined;

  return (
    <div className="min-h-screen bg-surface-page px-4 pb-28 pt-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1400px]">
        <ProductCreateForm
          role={profile.role}
          markets={markets}
          defaultMarketId={defaultMarketId}
          lockedMarketId={lockedMarketId}
          locale={params.locale}
          currencySymbol={currencySymbol}
        />
      </div>
    </div>
  );
}
