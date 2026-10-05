import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { ProductEditV6 } from "@/components/products/v6/ProductEditV6";

const TABS = ["general", "prix", "var", "stock", "fiche"] as const;
type Tab = (typeof TABS)[number];

/*
 * MODIFIER LE PRODUIT — prototypes/products-v6.html (edit), approved 2026-10-03.
 *
 * Costs, stock and identity stay super_admin only (same gate as
 * PATCH /api/products/[id]). A market manager reaches this page to author the
 * agent-facing sheet of their own market and nothing else: the page shows them
 * the « Fiche agent » tab only, and the write goes through
 * PUT /api/products/[id]/agent-content.
 *
 * The per-delivery calculator and the stock facts come from
 * /api/products/[id]/overview (last 30 days), fetched by the page itself — the
 * flat carriers.delivery_fee average and the `status = 'uploaded'` in-flight
 * count this page used to read are gone (plans/products-redesign-v6.md §1).
 */
export default async function EditProductPage({
  params,
  searchParams,
}: {
  params: { locale: string; id: string };
  searchParams: { tab?: string };
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

  const canManageCosts = profile.role === "super_admin";
  if (!canManageCosts && profile.role !== "market_manager") {
    redirect(`/${params.locale}/products/${params.id}`);
  }

  const { data: product, error } = await supabase
    .from("products")
    .select(
      "id, market_id, name, sku, description, image_url, unit_cogs, packing_cost, confirmation_processing_cost, default_price, floor_price, low_stock_threshold, is_active, current_stock, damaged_return_count, agent_brief, agent_brief_tone, agent_notes, agent_composition, agent_contraindications, agent_usage, cross_sell_product_id",
    )
    .eq("id", params.id)
    .is("deleted_at", null)
    .single();

  if (error || !product) notFound();

  if (!canManageCosts && product.market_id !== profile.market_id) {
    redirect(`/${params.locale}/products`);
  }

  const [{ data: variants }, { data: crossSellOptions }, { data: market }] = await Promise.all([
    supabase
      .from("product_variants")
      // Les deux axes, et de quoi les éditer. `kind` d'abord dans le tri : les
      // tailles avant les paliers, parce qu'un palier se choisit après la taille.
      .select(
        "id, kind, label, sku, agent_note, quantity, unit_cogs, display_price, current_stock, damaged_return_count, is_active",
      )
      .eq("product_id", params.id)
      .order("kind")
      .order("quantity"),
    // Cross-sell candidates: active products in the same market, never itself.
    supabase
      .from("products")
      .select("id, name")
      .eq("market_id", product.market_id)
      .eq("is_active", true)
      .is("deleted_at", null)
      .neq("id", params.id)
      .order("name"),
    supabase.from("markets").select("currency").eq("id", product.market_id).single(),
  ]);

  const tab = TABS.find((t) => t === searchParams.tab) as Tab | undefined;

  return (
    <ProductEditV6
      locale={params.locale}
      role={profile.role}
      currency={(market as { currency?: string } | null)?.currency ?? "TND"}
      initialTab={tab}
      crossSellOptions={crossSellOptions ?? []}
      variantNotes={(variants ?? []).map((v) => ({
        id: v.id,
        label: v.label,
        agent_note: v.agent_note ?? null,
      }))}
      variants={(variants ?? []).map((v) => ({
        id: v.id,
        kind: v.kind === "attribute" ? ("attribute" as const) : ("pack" as const),
        label: v.label,
        sku: v.sku ?? null,
        quantity: Number(v.quantity ?? 1),
        unit_cogs: Number(v.unit_cogs ?? 0),
        display_price: Number(v.display_price ?? 0),
        current_stock: Number(v.current_stock ?? 0),
        damaged_return_count: Number(v.damaged_return_count ?? 0),
        is_active: v.is_active !== false,
      }))}
      product={{
        id: product.id,
        market_id: product.market_id,
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
        floor_price: product.floor_price === null ? null : Number(product.floor_price),
        unit_cogs: Number(product.unit_cogs),
        packing_cost: Number(product.packing_cost),
        confirmation_processing_cost:
          product.confirmation_processing_cost === null ? null : Number(product.confirmation_processing_cost),
        default_price: product.default_price === null ? null : Number(product.default_price),
        low_stock_threshold: Number(product.low_stock_threshold),
        is_active: product.is_active,
        current_stock: Number(product.current_stock),
        damaged_return_count: Number(product.damaged_return_count ?? 0),
      }}
    />
  );
}
