import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { buildConfig } from "@/lib/carriers/dispatch";
import {
  loadCarrierProductMappings,
  resolveWarehouseLines,
  fetchDarbWarehouseStock,
  availableFor,
  effectiveOrderLines,
} from "@/lib/carriers/carrier-warehouse";
import type { OrderItem } from "@/types/order-items";

export const dynamic = "force-dynamic";

/**
 * Can this order be fulfilled from the carrier's own warehouse?
 *
 * Answers the dispatch modal's question before the agent commits: every line
 * must map to carrier-side stock (carrier_product_mappings) AND the carrier
 * must hold enough of it right now. Read-only — the authoritative re-check
 * runs server-side in performDispatch at upload time.
 *
 * When unavailable we return the reason rather than hiding the option, so the
 * agent learns what to fix (unmapped product vs. carrier out of stock).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const actor = actorResult.actor;

  const carrierId = req.nextUrl.searchParams.get("carrier_id");
  if (!carrierId) {
    return NextResponse.json({ error: "carrier_id is required" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: order } = await admin
    .from("orders")
    .select(
      "id, market_id, assigned_to, product_id, product_name, variant_label, quantity, total_price"
    )
    .eq("id", orderId)
    .single<{
      id: string;
      market_id: string;
      assigned_to: string | null;
      product_id: string | null;
      product_name: string;
      variant_label: string | null;
      quantity: number;
      total_price: number;
    }>();

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Market isolation + agent ownership, mirroring the dispatch route.
  if (actor.role !== "super_admin" && actor.market_id !== order.market_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (actor.role === "agent" && order.assigned_to !== actor.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: carrier } = await admin
    .from("carriers")
    .select(
      "id, code, api_endpoint, api_credentials, delivery_fee, return_fee, market_id, is_active"
    )
    .eq("id", carrierId)
    .single<{
      id: string;
      code: string;
      api_endpoint: string | null;
      api_credentials: string | null;
      delivery_fee: number;
      return_fee: number;
      market_id: string;
      is_active: boolean;
    }>();

  if (!carrier || carrier.market_id !== order.market_id) {
    return NextResponse.json({ error: "Carrier not found" }, { status: 404 });
  }

  const { data: itemRows } = await admin
    .from("order_items")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });

  // Same header fallback performDispatch uses, so the modal's answer and the
  // upload-time decision can never disagree.
  const orderItems = effectiveOrderLines((itemRows as OrderItem[] | null) ?? [], {
    product_id: order.product_id,
    product_name: order.product_name,
    variant_label: order.variant_label,
    quantity: order.quantity,
    total_price: order.total_price,
  });

  const productIds = [
    ...new Set(
      orderItems
        .map((it) => it.product_id)
        .filter((pid): pid is string => Boolean(pid))
    ),
  ];
  const mappings = await loadCarrierProductMappings(admin, carrierId, productIds);
  const resolved = resolveWarehouseLines(mappings, orderItems);

  if (!resolved.ok) {
    return NextResponse.json({ available: false, reason: resolved.error, lines: [] });
  }

  let config;
  try {
    config = buildConfig(carrier);
  } catch {
    return NextResponse.json(
      { available: false, reason: "Identifiants transporteur invalides", lines: [] },
      { status: 200 }
    );
  }

  const stock = await fetchDarbWarehouseStock(config, resolved.warehouseId);

  const lines = resolved.lines.map((line, i) => {
    const item = orderItems[i];
    const available = availableFor(
      stock,
      line.external_product_id,
      line.external_variant_id
    );
    return {
      product_name: item?.product_name ?? "",
      sku: line.external_sku ?? null,
      requested: item?.quantity ?? 0,
      available,
      sufficient: available >= (item?.quantity ?? 0),
    };
  });

  const insufficient = lines.filter((l) => !l.sufficient);

  return NextResponse.json({
    available: insufficient.length === 0,
    reason:
      insufficient.length > 0
        ? `Stock insuffisant chez le transporteur : ${insufficient
            .map((l) => `${l.sku ?? l.product_name} (${l.available}/${l.requested})`)
            .join(", ")}`
        : null,
    warehouse_id: resolved.warehouseId,
    lines,
  });
}
