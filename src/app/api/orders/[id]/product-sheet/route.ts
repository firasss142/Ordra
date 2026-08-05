import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { checkProductSheet, type SheetCheckVariant } from "@/lib/products/sheet-checks";
import { computeSignals } from "@/lib/products/signals";
import { formatDisplayCurrencyCode } from "@/lib/markets";

export const dynamic = "force-dynamic";

/**
 * Agent-facing product knowledge + verification sheet, scoped to an order.
 *
 * Order-scoped, not product-scoped, on purpose:
 *   - it reuses the "agent owns this order" authorization every agent route
 *     already applies, instead of granting agents a general product-read
 *     capability (canViewProducts is deliberately false for them);
 *   - the verification checks need order data anyway, so one round trip;
 *   - the requested product must actually be on the order, so an owned order
 *     cannot be used as a lens to browse the catalogue.
 *
 * The product read goes through the ADMIN client. The `products_select` RLS
 * policy (20260417_allow_agents_read_products_for_order_creation.sql) hides
 * `is_active = false` rows from agents — which would make a deactivated
 * product indistinguishable from an unmapped one, exactly the case the agent
 * most needs warning about. Authorization is done above on the order instead,
 * and the projection below is an explicit column list so the financial
 * columns can never leak.
 */

const PRODUCT_COLUMNS = [
  "id",
  "market_id",
  "name",
  "description",
  "image_url",
  "default_price",
  "floor_price",
  "current_stock",
  "low_stock_threshold",
  "is_active",
  "agent_brief",
  "agent_brief_tone",
  "agent_notes",
  "agent_composition",
  "agent_contraindications",
  "agent_usage",
  "cross_sell_product_id",
  "agent_content_updated_at",
].join(", ");

/** Minimal projection for the cross-sell card — never the full sheet. */
const CROSS_SELL_COLUMNS = "id, market_id, name, image_url, default_price, is_active";

interface OrderRow {
  id: string;
  market_id: string;
  assigned_to: string | null;
  product_id: string | null;
  product_variant_id: string | null;
  product_name: string;
  variant_label: string | null;
  unit_price: number;
  currency: string | null;
}

interface ItemRow {
  id: string;
  product_id: string | null;
  variant_id: string | null;
  variant_label: string | null;
  unit_price: number;
}

function notFound() {
  return NextResponse.json({ error: "Order not found" }, { status: 404 });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  if (role !== "agent" && role !== "market_manager" && role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select(
      "id, market_id, assigned_to, product_id, product_variant_id, product_name, variant_label, unit_price, currency",
    )
    .eq("id", id)
    .single<OrderRow>();

  if (orderError || !order) return notFound();

  // Ownership is the authorization boundary. 404 rather than 403 so an agent
  // cannot probe for the existence of other agents' orders.
  if (role === "agent" && order.assigned_to !== actor.id) return notFound();
  if (role === "market_manager" && order.market_id !== actor.market_id) return notFound();

  const { data: itemRows } = await supabase
    .from("order_items")
    .select("id, product_id, variant_id, variant_label, unit_price")
    .eq("order_id", id);

  const items = (itemRows ?? []) as ItemRow[];

  // Which product this sheet is about. Multi-item orders pass ?product_id so
  // each receipt line can open its own sheet.
  const requested = req.nextUrl.searchParams.get("product_id");
  const onOrder = new Set(
    [order.product_id, ...items.map((it) => it.product_id)].filter(Boolean) as string[],
  );

  const admin = createAdminClient();

  // The allow-set is the order's own products plus ONE hop to each of their
  // cross-sell targets. That keeps the drill-through working without turning
  // an owned order into a lens on the whole catalogue.
  let isCrossSellView = false;
  if (requested && !onOrder.has(requested)) {
    if (onOrder.size === 0) return notFound();

    const { data: hopRows } = await admin
      .from("products")
      .select("cross_sell_product_id")
      .in("id", [...onOrder]);

    const oneHop = new Set(
      (hopRows ?? [])
        .map((r) => (r as { cross_sell_product_id: string | null }).cross_sell_product_id)
        .filter(Boolean) as string[],
    );

    if (!oneHop.has(requested)) return notFound();
    isCrossSellView = true;
  }

  const targetProductId = requested ?? order.product_id;

  // The line that corresponds to the product being inspected — its price and
  // variant are what the agent is actually confirming.
  const line = items.find((it) => it.product_id === targetProductId) ?? null;
  const unitPrice = line?.unit_price ?? order.unit_price;
  const variantLabel = line?.variant_label ?? order.variant_label;

  // orders.currency is NULL for every historical row — the column was added by
  // the storefront-mapping migration and only new webhook intake populates it.
  // Fall back to the market's currency the same way the order panel does,
  // otherwise the sheet and the WhatsApp message render a bare number.
  const currency = formatDisplayCurrencyCode(order.currency, order.market_id);

  const empty = {
    product: null,
    raw_product_name: order.product_name,
    media: [] as { id: string; url: string; alt: string | null; position: number }[],
    variants: [] as unknown[],
    signals: null,
    cross_sell: null,
    is_cross_sell_view: false,
    currency,
  };

  if (!targetProductId) {
    return NextResponse.json({
      ...empty,
      checks: checkProductSheet(
        { product_id: null, variant_id: null, unit_price: unitPrice },
        null,
        [],
      ),
    });
  }

  const { data: product, error: productError } = await admin
    .from("products")
    .select(PRODUCT_COLUMNS)
    .eq("id", targetProductId)
    .single();

  // Product row vanished (deleted, or the FK points nowhere) — same story for
  // the agent as an unmapped order: nothing to verify against.
  if (productError || !product) {
    return NextResponse.json({
      ...empty,
      checks: checkProductSheet(
        { product_id: targetProductId, variant_id: null, unit_price: unitPrice },
        null,
        [],
      ),
    });
  }

  const p = product as unknown as {
    id: string;
    market_id: string;
    name: string;
    description: string | null;
    image_url: string | null;
    default_price: number | null;
    floor_price: number | null;
    current_stock: number;
    low_stock_threshold: number;
    is_active: boolean;
    agent_brief: string | null;
    agent_brief_tone: string | null;
    agent_notes: string | null;
    agent_composition: string | null;
    agent_contraindications: string | null;
    agent_usage: string | null;
    cross_sell_product_id: string | null;
    agent_content_updated_at: string | null;
  };

  // Defence in depth: the admin client bypasses RLS, so re-assert market
  // isolation by hand.
  if (p.market_id !== order.market_id) return notFound();

  const { data: variantRows } = await admin
    .from("product_variants")
    .select("id, label, quantity, display_price, is_active, agent_note")
    .eq("product_id", targetProductId)
    .order("quantity");

  const variants = (variantRows ?? []) as (SheetCheckVariant & {
    quantity: number;
    agent_note: string | null;
  })[];

  // orders has no variant_id column — only variant_label and the storefront
  // mapping's product_variant_id. Resolve in order of reliability.
  const resolvedVariantId =
    line?.variant_id ??
    order.product_variant_id ??
    variants.find((v) => variantLabel != null && v.label === variantLabel)?.id ??
    null;

  const checks = checkProductSheet(
    { product_id: targetProductId, variant_id: resolvedVariantId, unit_price: unitPrice },
    {
      id: p.id,
      is_active: p.is_active,
      current_stock: p.current_stock,
      low_stock_threshold: p.low_stock_threshold,
      default_price: p.default_price,
    },
    variants,
    // Order-relative checks are meaningless for a cross-sell preview.
    { compareToOrder: !isCrossSellView },
  );

  // Outcome signals and the cross-sell card in parallel — neither blocks the
  // other, and both are optional garnish on the sheet.
  const [signalsRes, crossSellRes] = await Promise.all([
    admin.rpc("get_product_agent_signals", {
      p_product_id: targetProductId,
      p_market_id: order.market_id,
    }),
    p.cross_sell_product_id
      ? admin
          .from("products")
          .select(CROSS_SELL_COLUMNS)
          .eq("id", p.cross_sell_product_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  // A missing signals row means the product has no orders yet, not an error.
  const rawSignals = Array.isArray(signalsRes.data) ? signalsRes.data[0] : signalsRes.data;
  const signals = computeSignals({
    rejected: Number(rawSignals?.rejected ?? 0),
    confirmed: Number(rawSignals?.confirmed ?? 0),
    delivered: Number(rawSignals?.delivered ?? 0),
    returned: Number(rawSignals?.returned ?? 0),
    top_rejection_reason: rawSignals?.top_rejection_reason ?? null,
  });

  const cs = crossSellRes.data as {
    id: string;
    market_id: string;
    name: string;
    image_url: string | null;
    default_price: number | null;
    is_active: boolean;
  } | null;

  // Re-assert market isolation on the hop, and never advertise a deactivated
  // alternative — offering something that cannot be sold wastes the call.
  const crossSell =
    cs && cs.market_id === order.market_id && cs.is_active
      ? {
          id: cs.id,
          name: cs.name,
          image_url: cs.image_url,
          default_price: cs.default_price,
        }
      : null;

  // Phase 1 keeps the single products.image_url as a one-entry gallery; the
  // product_media table replaces this without changing the response shape.
  const media = p.image_url
    ? [{ id: `${p.id}-cover`, url: p.image_url, alt: p.name, position: 0 }]
    : [];

  return NextResponse.json({
    product: {
      id: p.id,
      name: p.name,
      description: p.description,
      default_price: p.default_price,
      current_stock: p.current_stock,
      low_stock_threshold: p.low_stock_threshold,
      is_active: p.is_active,
      floor_price: p.floor_price,
      agent_brief: p.agent_brief,
      agent_brief_tone: p.agent_brief_tone ?? "info",
      agent_notes: p.agent_notes,
      agent_composition: p.agent_composition,
      agent_contraindications: p.agent_contraindications,
      agent_usage: p.agent_usage,
      agent_content_updated_at: p.agent_content_updated_at,
    },
    raw_product_name: order.product_name,
    media,
    variants: variants.map((v) => ({
      id: v.id,
      label: v.label,
      quantity: v.quantity,
      display_price: v.display_price,
      is_active: v.is_active,
      agent_note: v.agent_note,
      is_ordered: v.id === resolvedVariantId,
    })),
    checks,
    signals,
    cross_sell: crossSell,
    is_cross_sell_view: isCrossSellView,
    currency,
  });
}
