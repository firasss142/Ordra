import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ProductsListV6 } from "@/components/products/v6/ProductsListV6";
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
      <div className="min-h-screen bg-surface-page px-[16px] pb-[120px] pt-[16px] md:px-[28px] md:pt-[24px]">
        <div className="mx-auto max-w-[1260px] rounded-[14px] border border-line-subtle bg-surface-card px-6 py-16 text-center text-[14px] text-ink-secondary">
          {t("noPermission")}
        </div>
      </div>
    );
  }

  // Padding is the prototype's <main> (24px 28px 120px; 16px on a phone).
  return (
    <div className="min-h-screen bg-surface-page px-[16px] pb-[120px] pt-[16px] md:px-[28px] md:pt-[24px]">
      <ProductsListV6 role={profile.role} userMarketId={profile.market_id ?? null} locale={params.locale} />
    </div>
  );
}
