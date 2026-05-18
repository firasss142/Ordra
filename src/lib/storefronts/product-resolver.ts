import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProductResolution } from "./resolver-types";

/**
 * Resolves a webhook line item to an OMS product (and optionally a specific
 * product_variant), replacing the old inline SKU/name matching in the webhook
 * handler.
 *
 * Resolution order, strongest first:
 *   1. Explicit mapping  — storefront_product_mappings on
 *                          (storefront_id, external_variant_id)
 *   2. SKU exact match   — products.sku, market-scoped
 *   3. Name ILIKE match  — products.name, market-scoped (fragile → needs review)
 *   4. Unmatched         — product_id stays null
 *
 * Split, like auto-assignment: `decideProductResolution` is the pure decision
 * core (DB-free, fully unit-tested); `resolveProduct` is the thin IO wrapper.
 */

/** Pre-fetched inputs the pure decision core needs. */
export interface ProductResolverInput {
  /** storefront_product_mappings row for this (storefront, variant), or null. */
  mappingRow: { product_id: string; product_variant_id: string | null } | null;
  /** products.id from the market-scoped SKU lookup, or null. */
  skuProductId: string | null;
  /** products.id from the market-scoped name ILIKE lookup, or null. */
  nameProductId: string | null;
}

/** Pure, deterministic resolution decision — no IO. */
export function decideProductResolution(
  input: ProductResolverInput,
): ProductResolution {
  if (input.mappingRow) {
    return {
      product_id: input.mappingRow.product_id,
      product_variant_id: input.mappingRow.product_variant_id,
      match_method: "mapping",
    };
  }
  if (input.skuProductId) {
    return {
      product_id: input.skuProductId,
      product_variant_id: null,
      match_method: "sku",
    };
  }
  if (input.nameProductId) {
    return {
      product_id: input.nameProductId,
      product_variant_id: null,
      match_method: "name",
    };
  }
  return { product_id: null, product_variant_id: null, match_method: "none" };
}

export interface ResolveProductParams {
  storefront_id: string;
  market_id: string;
  external_variant_id: string | null;
  sku: string | null;
  product_name: string;
}

/**
 * IO wrapper: runs the (up to three) market-scoped reads in resolution order,
 * short-circuiting as soon as a stronger match is found, then defers to the
 * pure core for the decision.
 */
export async function resolveProduct(
  adminClient: SupabaseClient,
  params: ResolveProductParams,
): Promise<ProductResolution> {
  // 1. Explicit mapping — only meaningful when the payload carried a variant id.
  let mappingRow: ProductResolverInput["mappingRow"] = null;
  if (params.external_variant_id) {
    const { data } = await adminClient
      .from("storefront_product_mappings")
      .select("product_id, product_variant_id")
      .eq("storefront_id", params.storefront_id)
      .eq("external_variant_id", params.external_variant_id)
      .maybeSingle();
    mappingRow = (data as ProductResolverInput["mappingRow"]) ?? null;
  }
  if (mappingRow) {
    return decideProductResolution({
      mappingRow,
      skuProductId: null,
      nameProductId: null,
    });
  }

  // 2. SKU exact match, market-scoped.
  let skuProductId: string | null = null;
  if (params.sku) {
    const { data } = await adminClient
      .from("products")
      .select("id")
      .eq("market_id", params.market_id)
      .eq("sku", params.sku)
      .limit(1)
      .maybeSingle();
    skuProductId = (data as { id: string } | null)?.id ?? null;
  }
  if (skuProductId) {
    return decideProductResolution({
      mappingRow: null,
      skuProductId,
      nameProductId: null,
    });
  }

  // 3. Name ILIKE match, market-scoped — last resort, flagged needs_review.
  let nameProductId: string | null = null;
  if (params.product_name) {
    const { data } = await adminClient
      .from("products")
      .select("id")
      .eq("market_id", params.market_id)
      .ilike("name", params.product_name)
      .limit(1)
      .maybeSingle();
    nameProductId = (data as { id: string } | null)?.id ?? null;
  }

  return decideProductResolution({
    mappingRow: null,
    skuProductId: null,
    nameProductId,
  });
}
