import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ProductsListV6 } from "@/components/products/v6/ProductsListV6";
import { canViewProductProfitability } from "@/lib/finance-permissions";
import { getTranslations } from "next-intl/server";
import "@/components/finance/kit/finance-kit.css";
import "@/components/products/v6/products-v6.css";

export default async function ProductsPage({
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

  // The list is about what each product earns: without the money (warehouse
  // agents), it has nothing to say — they keep Entrepôt › Stock.
  if (!canViewProductProfitability(profile.role)) {
    const t = await getTranslations({ locale: params.locale, namespace: "products" });
    return (
      <div className="fin prd">
        <div className="page">
          <section className="card empty">{t("noPermission")}</section>
        </div>
      </div>
    );
  }

  return <ProductsListV6 role={profile.role} userMarketId={profile.market_id ?? null} locale={params.locale} />;
}
