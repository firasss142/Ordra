import type { SupabaseClient } from "@supabase/supabase-js";
import type { InternalOrderData } from "@/lib/storefronts/types";
import { resolveProduct } from "@/lib/storefronts/product-resolver";
import { resolveCity } from "@/lib/storefronts/city-resolver";
import {
  productMatchStatus,
  cityMatchStatus,
  worstMappingStatus,
} from "@/lib/storefronts/resolver-types";
import { tryAutoAssign } from "./auto-assignment-orchestrator";

export interface CreateOrderParams {
  adminClient: SupabaseClient;
  storefront: { id: string; market_id: string };
  orderData: InternalOrderData;
  rawPayload: Record<string, unknown>;
  sourceNote: string;
}

export interface CreateOrderResult {
  orderId: string | null;
  status: "created" | "duplicate" | "error";
  error?: string;
}

/**
 * Core order-creation logic shared by webhook intake and the Google Sheets
 * sync engine. Resolves product/city, inserts the order, appends order_history,
 * and attempts auto-assignment. Does not perform signature validation or
 * webhook-specific logging — callers handle those.
 */
export async function createOrderFromData(
  params: CreateOrderParams
): Promise<CreateOrderResult> {
  const { adminClient, storefront, orderData, rawPayload, sourceNote } = params;

  const productResolution = await resolveProduct(adminClient, {
    storefront_id: storefront.id,
    market_id: storefront.market_id,
    external_variant_id: orderData.external_variant_id ?? null,
    sku: orderData.sku,
    product_name: orderData.product_name,
  });
  const cityResolution = await resolveCity(adminClient, {
    platform: orderData.external_platform,
    market_id: storefront.market_id,
    customer_city: orderData.customer_city,
  });
  const mappingStatus = worstMappingStatus(
    productMatchStatus(productResolution.match_method),
    cityMatchStatus(cityResolution.match_method)
  );

  const { data: order, error: insertError } = await adminClient
    .from("orders")
    .insert({
      market_id: storefront.market_id,
      storefront_id: storefront.id,
      external_id: orderData.external_id,
      external_platform: orderData.external_platform,
      status: "pending",
      customer_name: orderData.customer_name,
      customer_phone: orderData.customer_phone,
      customer_address: orderData.customer_address,
      customer_city: orderData.customer_city,
      customer_note: orderData.customer_note,
      product_id: productResolution.product_id,
      product_variant_id: productResolution.product_variant_id,
      product_name: orderData.product_name,
      variant_label: orderData.variant_label,
      quantity: orderData.quantity,
      unit_price: orderData.unit_price,
      total_price: orderData.total_price,
      city_id: cityResolution.city_id,
      dexpress_state_id: cityResolution.dexpress_state_id ?? orderData.dexpress_state_id,
      mapping_status: mappingStatus,
      external_product_id: orderData.external_product_id ?? null,
      external_variant_id: orderData.external_variant_id ?? null,
      external_route_id: orderData.external_route_id ?? null,
      currency: orderData.currency ?? null,
      raw_payload: rawPayload,
    })
    .select("id")
    .single();

  if (insertError) {
    if ((insertError as { code?: string }).code === "23505") {
      const { data: existing } = await adminClient
        .from("orders")
        .select("id")
        .eq("storefront_id", storefront.id)
        .eq("external_id", orderData.external_id)
        .single();
      return { status: "duplicate", orderId: existing?.id ?? null };
    }
    return { status: "error", orderId: null, error: insertError.message };
  }

  if (!order) {
    return { status: "error", orderId: null, error: "Failed to create order" };
  }

  await adminClient.from("order_history").insert({
    order_id: order.id,
    status_from: null,
    status_to: "pending",
    actor_id: null,
    actor_type: "system",
    note: sourceNote,
  });

  if (mappingStatus !== "mapped") {
    const parts: string[] = [];
    if (productMatchStatus(productResolution.match_method) !== "mapped") {
      parts.push(
        productResolution.product_id
          ? `product matched by name only (variant ${orderData.external_variant_id ?? "n/a"})`
          : `product unmatched (variant ${orderData.external_variant_id ?? "n/a"})`
      );
    }
    if (cityMatchStatus(cityResolution.match_method) !== "mapped") {
      parts.push(`city unmatched ("${orderData.customer_city ?? "n/a"}")`);
    }
    await adminClient.from("order_history").insert({
      order_id: order.id,
      status_from: "pending",
      status_to: "pending",
      actor_id: null,
      actor_type: "system",
      note: `Mapping needs review: ${parts.join("; ")}`,
    });
  }

  try {
    await tryAutoAssign(adminClient, {
      id: order.id,
      market_id: storefront.market_id,
      product_id: productResolution.product_id,
      customer_city: orderData.customer_city,
      city_id: cityResolution.city_id,
    });
  } catch {
    // Best-effort — order stays pending for manual assignment
  }

  return { status: "created", orderId: order.id };
}
