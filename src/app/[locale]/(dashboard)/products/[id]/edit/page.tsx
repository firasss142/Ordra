import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { ProductEditForm } from "@/components/products/ProductEditForm";

export default async function EditProductPage({
  params,
}: {
  params: { locale: string; id: string };
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

  // Edit is super_admin only — same gate as PATCH /api/products/[id]
  if (profile.role !== "super_admin") {
    redirect(`/${params.locale}/products/${params.id}`);
  }

  const { data: product, error } = await supabase
    .from("products")
    .select(
      "id, market_id, name, sku, description, image_url, unit_cogs, packing_cost, cpl, confirmation_processing_cost, default_price, low_stock_threshold, is_active",
    )
    .eq("id", params.id)
    .single();

  if (error || !product) notFound();

  return (
    <div style={{ padding: 24, backgroundColor: "#F6F6F7", minHeight: "100vh" }}>
      <div
        style={{
          backgroundColor: "white",
          borderRadius: "0.5rem",
          border: "1px solid #E1E3E5",
          padding: 32,
          maxWidth: 640,
        }}
      >
        <ProductEditForm
          locale={params.locale}
          product={{
            id: product.id,
            name: product.name,
            sku: product.sku ?? null,
            description: product.description ?? null,
            image_url: product.image_url ?? null,
            unit_cogs: Number(product.unit_cogs),
            packing_cost: Number(product.packing_cost),
            cpl: Number(product.cpl),
            confirmation_processing_cost:
              product.confirmation_processing_cost === null
                ? null
                : Number(product.confirmation_processing_cost),
            default_price:
              product.default_price === null ? null : Number(product.default_price),
            low_stock_threshold: Number(product.low_stock_threshold),
            is_active: product.is_active,
          }}
        />
      </div>
    </div>
  );
}
