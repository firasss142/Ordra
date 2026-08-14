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

  // Costs, stock and identity stay super_admin only (same gate as
  // PATCH /api/products/[id]). Market managers reach this page to author the
  // agent-facing content for their own market and nothing else — the form
  // renders only that section for them, and the write goes through
  // PUT /api/products/[id]/agent-content.
  const canManageCosts = profile.role === "super_admin";
  if (!canManageCosts && profile.role !== "market_manager") {
    redirect(`/${params.locale}/products/${params.id}`);
  }

  const { data: product, error } = await supabase
    .from("products")
    .select(
      "id, market_id, name, sku, description, image_url, unit_cogs, packing_cost, confirmation_processing_cost, default_price, floor_price, low_stock_threshold, is_active, current_stock, agent_brief, agent_brief_tone, agent_notes, agent_composition, agent_contraindications, agent_usage, cross_sell_product_id",
    )
    .eq("id", params.id)
    .single();

  if (error || !product) notFound();

  if (!canManageCosts && product.market_id !== profile.market_id) {
    redirect(`/${params.locale}/products`);
  }

  const { data: variants } = await supabase
    .from("product_variants")
    .select("id, label, agent_note")
    .eq("product_id", params.id)
    .order("quantity");

  // Cross-sell candidates: active products in the same market, never itself.
  const { data: crossSellOptions } = await supabase
    .from("products")
    .select("id, name")
    .eq("market_id", product.market_id)
    .eq("is_active", true)
    .neq("id", params.id)
    .order("name");

  // ── chiffres que seul le serveur peut établir ────────────────────────────
  // Le formulaire ne recalcule rien : la marge unitaire en direct a besoin du
  // frais de livraison MOYEN RÉELLEMENT OBSERVÉ (moyenne des delivery_fee des
  // transporteurs sur les livraisons de ce produit), et la carte « Impact » du
  // nombre de commandes encore chez le transporteur. Absents, le formulaire
  // masque ces lignes plutôt que d'afficher un nombre plausible mais faux.
  const [{ data: market }, { data: deliveredRows }, { count: inFlightCount }] =
    await Promise.all([
      supabase.from("markets").select("currency").eq("id", product.market_id).single(),
      supabase
        .from("orders")
        .select("carriers!orders_carrier_id_fkey(delivery_fee)")
        .eq("product_id", params.id)
        .eq("status", "delivered"),
      supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("product_id", params.id)
        .eq("status", "uploaded"),
    ]);

  // Le type généré déclare l'embed `carriers` comme un TABLEAU alors que la
  // relation est to-one — même compromis que lib/products/metrics.ts. On accepte
  // les deux formes plutôt que de mentir au compilateur.
  type CarrierEmbed = { delivery_fee: number | string } | { delivery_fee: number | string }[] | null;
  const fees = (deliveredRows ?? [])
    .map((r) => {
      const c = (r as unknown as { carriers: CarrierEmbed }).carriers;
      const one = Array.isArray(c) ? c[0] : c;
      return one ? Number(one.delivery_fee) : null;
    })
    .filter((f): f is number => f !== null && Number.isFinite(f));
  const avgDeliveryFee =
    fees.length > 0 ? fees.reduce((s, f) => s + f, 0) / fees.length : undefined;

  const currencySymbol = market?.currency === "LYD" ? "د.ل" : market?.currency === "TND" ? "DT" : undefined;

  return (
    <div className="min-h-screen bg-surface-page px-4 pb-28 pt-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1400px]">
        <ProductEditForm
          locale={params.locale}
          canManageCosts={canManageCosts}
          avgDeliveryFee={avgDeliveryFee}
          currencySymbol={currencySymbol}
          currentStock={Number(product.current_stock)}
          inFlightCount={inFlightCount ?? undefined}
          variants={(variants ?? []).map((v) => ({
            id: v.id,
            label: v.label,
            agent_note: v.agent_note ?? null,
          }))}
          crossSellOptions={crossSellOptions ?? []}
          product={{
            id: product.id,
            name: product.name,
            sku: product.sku ?? null,
            description: product.description ?? null,
            image_url: product.image_url ?? null,
            agent_brief: product.agent_brief ?? null,
            agent_brief_tone: product.agent_brief_tone ?? "info",
            agent_notes: product.agent_notes ?? null,
            agent_composition: product.agent_composition ?? null,
            agent_contraindications: product.agent_contraindications ?? null,
            agent_usage: product.agent_usage ?? null,
            cross_sell_product_id: product.cross_sell_product_id ?? null,
            floor_price:
              product.floor_price === null ? null : Number(product.floor_price),
            unit_cogs: Number(product.unit_cogs),
            packing_cost: Number(product.packing_cost),
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
