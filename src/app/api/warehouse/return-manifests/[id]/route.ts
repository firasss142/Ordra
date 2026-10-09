import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";
import { summarizeReturnManifests } from "@/lib/carriers/manifests/return-view";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * One return (or exchange) list, line by line, for the scan screen.
 * Contract: docs/xdelivery-manifests.md. Read under the caller's RLS.
 *
 * Each line carries its parcel's order (customer, product, city, Ordra status) when
 * it is an Ordra order, and `setAsideAt` when that parcel was put aside on an
 * earlier list — the « mis de côté le … » tag.
 */

type Ctx = { params: { id: string } };

interface LineRow {
  id: string;
  barcode: string;
  order_id: string | null;
  state: string;
  received_at: string | null;
  orders: {
    external_id: string | null;
    customer_name: string | null;
    customer_city: string | null;
    product_name: string | null;
    quantity: number | null;
    status: string;
  } | null;
}

async function handleGET(req: NextRequest, ctx: Ctx) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: m, error } = await supabase
    .from("carrier_manifests")
    .select("id, kind, carrier_id, code, carrier_created_at, carrier_status, closed_at, closed_by, warehouse_id")
    .eq("id", ctx.params.id)
    .in("kind", ["return", "exchange"])
    .maybeSingle<{
      id: string;
      kind: "return" | "exchange";
      carrier_id: string;
      code: string | null;
      carrier_created_at: string | null;
      carrier_status: string | null;
      closed_at: string | null;
      closed_by: string | null;
      warehouse_id: string | null;
    }>();
  if (error) throw new Error(error.message);
  if (!m) return NextResponse.json({ error_code: "MANIFEST_NOT_FOUND" }, { status: 404 });

  const { data: lineRows, error: lErr } = await supabase
    .from("carrier_manifest_parcels")
    .select(
      "id, barcode, order_id, state, received_at, orders ( external_id, customer_name, customer_city, product_name, quantity, status )",
    )
    .eq("manifest_id", m.id)
    .order("barcode", { ascending: true });
  if (lErr) throw new Error(lErr.message);
  const lines = (lineRows ?? []) as unknown as LineRow[];

  const orderIds = lines.map((l) => l.order_id).filter((x): x is string => x !== null);
  const asideAt = new Map<string, string>();
  if (orderIds.length > 0) {
    const { data: asides, error: aErr } = await supabase
      .from("return_set_asides")
      .select("order_id, set_aside_at")
      .in("order_id", orderIds)
      .is("resolved_at", null);
    if (aErr) throw new Error(aErr.message);
    for (const a of (asides ?? []) as Array<{ order_id: string; set_aside_at: string }>) asideAt.set(a.order_id, a.set_aside_at);
  }

  const { manifests } = summarizeReturnManifests(
    [
      {
        id: m.id,
        kind: m.kind,
        carrierId: m.carrier_id,
        code: m.code,
        createdAt: m.carrier_created_at,
        carrierStatus: m.carrier_status,
        closedAt: m.closed_at,
        lines: lines.map((l) => ({ state: l.state, orderId: l.order_id })),
      },
    ],
    0,
  );

  return NextResponse.json({
    manifest: { ...manifests[0], warehouseId: m.warehouse_id, closedBy: m.closed_by },
    lines: lines.map((l) => ({
      parcelId: l.id,
      barcode: l.barcode,
      orderId: l.order_id,
      state: l.state,
      receivedAt: l.received_at,
      setAsideAt: l.order_id ? (asideAt.get(l.order_id) ?? null) : null,
      order: l.orders
        ? {
            externalId: l.orders.external_id,
            customerName: l.orders.customer_name,
            city: l.orders.customer_city,
            product: l.orders.product_name,
            quantity: l.orders.quantity,
            status: l.orders.status,
          }
        : null,
    })),
  });
}

export const GET = withRouteErrors("/api/warehouse/return-manifests/[id]", "GET", handleGET);
