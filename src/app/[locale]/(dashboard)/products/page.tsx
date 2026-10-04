import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ProductsListV6 } from "@/components/products/v6/ProductsListV6";
import { ProductsFrame } from "@/components/products/v6/ProductsFrame";
import { canViewProductProfitability } from "@/lib/finance-permissions";
import { getTranslations } from "next-intl/server";

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
      <ProductsFrame>
        <div className="mx-auto max-w-[1260px] rounded-[14px] border border-line-subtle bg-surface-card px-6 py-16 text-center text-[14px] text-ink-secondary">
          {t("noPermission")}
        </div>
      </ProductsFrame>
    );
  }

  return (
    <ProductsFrame>
      <ProductsListV6 role={profile.role} userMarketId={profile.market_id ?? null} locale={params.locale} />
    </ProductsFrame>
  );
}
