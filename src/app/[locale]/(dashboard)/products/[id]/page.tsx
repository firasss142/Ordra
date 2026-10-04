import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProductSheetV6 } from "@/components/products/v6/ProductSheetV6";
import { ProductsFrame } from "@/components/products/v6/ProductsFrame";

/*
 * FICHE PRODUIT — prototypes/products-v6.html (detail), approved 2026-10-03.
 *
 * Super admin and market managers read the whole sheet; a warehouse agent reads
 * the product and its stock, never the money (the overview route refuses them,
 * so the component does not ask). Default period: the last 30 days, not today —
 * a sheet opened in the morning would otherwise read as a breakdown.
 */
export default async function ProductSheetPage({
  params,
}: {
  params: { locale: string; id: string };
}) {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) redirect(`/${params.locale}/login`);

  const { data: profile } = await supabase.from("users").select("role").eq("id", authUser.id).single();
  if (!profile) redirect(`/${params.locale}/login`);

  const role = profile.role;
  if (role !== "super_admin" && role !== "market_manager" && role !== "warehouse_agent") {
    redirect(`/${params.locale}/products`);
  }

  return (
    <ProductsFrame>
      <ProductSheetV6 productId={params.id} role={role} locale={params.locale} />
    </ProductsFrame>
  );
}
