import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canPrintLabels } from "@/lib/role-permissions";
import type { Role } from "@/types";
import { resolveWarehouseScope } from "@/lib/warehouse/scope";
import { resolveSiteFilter } from "@/lib/warehouse/site-scope";
import { buildConfig, type CarrierRow } from "@/lib/carriers/dispatch";
import { buildXDeliveryLabel, type XDeliveryLabelInput } from "@/lib/labels/xdelivery-label";
import { xdeliveryLabelImages } from "@/lib/labels/xdelivery-label-images";
import {
  XDeliveryLabelPdf,
  XDELIVERY_LABEL_FORMATS,
  type XDeliveryLabelFormat,
  type XDeliveryPrintLabel,
} from "@/lib/labels/XDeliveryLabelPdf";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * Ordra labels for X-Delivery parcels (Phase 5, prototypes/xdelivery-label-v1.html).
 *
 * GET  → what is still to print, what was printed and when, and the last batch.
 * POST → { format: "a4x2" | "thermal", order_ids? } → the PDF; without ids, every label
 *        still to print. Each print writes `label_prints`, which is what scan_order_out
 *        requires of a carrier that supplies no sticker.
 *
 * A label exists only once the parcel is uploaded: it carries X-Delivery's number. The PDF
 * is rendered BEFORE the print is recorded, so a failed render never unlocks scan-out for
 * a parcel that has no label on it.
 */

export interface XDeliveryLabelSummary {
  /** The caller's building ships X-Delivery at all: the desk shows its label column only then. */
  enabled: boolean;
  toPrint: string[];
  /** order id → the latest print. */
  printed: Record<string, string>;
  lastBatch: { at: string; count: number; orderIds: string[] } | null;
}

type Actor = { id: string; role: string; market_id: string | null };

const ORDER_COLS =
  "id, carrier_id, market_id, external_id, tracking_number, customer_name, customer_phone, customer_city, customer_address, total_price, product_name, variant_label, quantity, carrier_extra";

type OrderRow = XDeliveryLabelInput["order"] & { carrier_id: string; market_id: string };

/** The caller's market and the X-Delivery accounts of the building(s) they work. */
async function scope(req: NextRequest, actor: Actor) {
  const supabase = await createClient();
  const { marketId } = resolveWarehouseScope(req, actor);
  if (!marketId) return null;
  const site = await resolveSiteFilter(supabase, { actor, requested: null });
  if (site.unassigned) return null;
  const { data } = await supabase
    .from("carriers")
    .select("id, warehouse_id")
    .eq("market_id", marketId)
    .eq("code", "xdelivery")
    .eq("is_active", true);
  const carrierIds = ((data ?? []) as Array<{ id: string; warehouse_id: string | null }>)
    .filter((c) => !site.pinned || c.warehouse_id === site.warehouseId)
    .map((c) => c.id);
  return carrierIds.length ? { supabase, marketId, carrierIds } : null;
}

type Scope = NonNullable<Awaited<ReturnType<typeof scope>>>;

async function uploadedOrders(sc: Scope, ids?: string[]): Promise<OrderRow[]> {
  let q = sc.supabase
    .from("orders")
    .select(ORDER_COLS)
    .in("carrier_id", sc.carrierIds)
    .eq("status", "uploaded")
    .is("archived_at", null)
    .not("tracking_number", "is", null);
  if (ids) q = q.in("id", ids);
  const { data } = await q.order("created_at", { ascending: true }).limit(500);
  return (data ?? []) as OrderRow[];
}

async function lastPrints(sc: Scope, orderIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (orderIds.length === 0) return out;
  const { data } = await sc.supabase
    .from("label_prints")
    .select("order_id, created_at")
    .in("order_id", orderIds)
    .order("created_at", { ascending: false });
  for (const r of (data ?? []) as Array<{ order_id: string; created_at: string }>) {
    if (!out.has(r.order_id)) out.set(r.order_id, r.created_at);
  }
  return out;
}

async function summary(sc: Scope): Promise<XDeliveryLabelSummary> {
  const orders = await uploadedOrders(sc);
  const printed = await lastPrints(sc, orders.map((o) => o.id));

  // The last batch is read from the prints themselves, not from the parcels still here:
  // scanning a parcel out must not shrink « 14 étiquettes » to 13.
  const since = new Date(Date.now() - 26 * 3_600_000).toISOString();
  const { data: recent } = await sc.supabase
    .from("label_prints")
    .select("order_id, batch_id, created_at, orders!inner(carrier_id)")
    .eq("market_id", sc.marketId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(500);
  const mine = ((recent ?? []) as Array<{
    order_id: string;
    batch_id: string;
    created_at: string;
    orders: { carrier_id: string } | Array<{ carrier_id: string }> | null;
  }>).filter((r) => {
    const o = Array.isArray(r.orders) ? r.orders[0] : r.orders;
    return o ? sc.carrierIds.includes(o.carrier_id) : false;
  });
  const latest = mine[0];
  const batch = latest ? mine.filter((r) => r.batch_id === latest.batch_id) : [];

  return {
    enabled: true,
    toPrint: orders.filter((o) => !printed.has(o.id)).map((o) => o.id),
    printed: Object.fromEntries(orders.filter((o) => printed.has(o.id)).map((o) => [o.id, printed.get(o.id)!])),
    lastBatch: latest ? { at: latest.created_at, count: batch.length, orderIds: batch.map((r) => r.order_id) } : null,
  };
}

async function handleGET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (!canPrintLabels(actor.role as Role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sc = await scope(req, actor);
  const empty: XDeliveryLabelSummary = { enabled: false, toPrint: [], printed: {}, lastBatch: null };
  return NextResponse.json(sc ? await summary(sc) : empty);
}

async function handlePOST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (!canPrintLabels(actor.role as Role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: { format?: unknown; order_ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const format = body.format as XDeliveryLabelFormat;
  if (typeof format !== "string" || !(format in XDELIVERY_LABEL_FORMATS)) {
    return NextResponse.json({ error: "format must be a4x2 or thermal" }, { status: 400 });
  }
  const ids = Array.isArray(body.order_ids)
    ? body.order_ids.filter((x): x is string => typeof x === "string")
    : undefined;

  const sc = await scope(req, actor);
  if (!sc) return NextResponse.json({ error: "nothing_to_print" }, { status: 404 });

  let orders = await uploadedOrders(sc, ids);
  const printedBefore = await lastPrints(sc, orders.map((o) => o.id));
  // No ids: the desk's « Imprimer les N » — only what has never been printed.
  if (!ids) orders = orders.filter((o) => !printedBefore.has(o.id));
  if (orders.length === 0) return NextResponse.json({ error: "nothing_to_print" }, { status: 404 });

  const orderIds = orders.map((o) => o.id);
  const [{ data: itemRows }, { data: market }] = await Promise.all([
    sc.supabase.from("order_items").select("order_id, product_name, variant_label, quantity").in("order_id", orderIds),
    sc.supabase.from("markets").select("sender_name, sender_phone").eq("id", sc.marketId).maybeSingle<{
      sender_name: string | null;
      sender_phone: string | null;
    }>(),
  ]);

  // « Ouvrir le colis » is an account setting, sent with every parcel; the credentials are
  // encrypted, so the service role reads them — for the accounts already in scope only.
  const { data: carrierRows } = await createAdminClient()
    .from("carriers")
    .select("*")
    .in("id", [...new Set(orders.map((o) => o.carrier_id))]);
  const opened = new Map(
    ((carrierRows ?? []) as CarrierRow[]).map((c) => [c.id, buildConfig(c).apiCredentials?.is_opened === "1"]),
  );

  const items = (itemRows ?? []) as Array<{
    order_id: string;
    product_name: string | null;
    variant_label: string | null;
    quantity: number | null;
  }>;
  const now = new Date();
  const labels: XDeliveryPrintLabel[] = await Promise.all(
    orders.map(async (o) => {
      const data = buildXDeliveryLabel({
        order: o,
        items: items.filter((i) => i.order_id === o.id),
        isOpened: opened.get(o.carrier_id) ?? false,
        sender: { name: market?.sender_name ?? null, phone: market?.sender_phone ?? null },
        printedAt: now,
      });
      return { ...data, ...(await xdeliveryLabelImages(data.barcode, data.qr, format)) };
    }),
  );

  const pdf = await renderToBuffer(
    React.createElement(XDeliveryLabelPdf, { labels, format }) as unknown as React.ReactElement<DocumentProps>,
  );

  const batchId = randomUUID();
  const { error } = await sc.supabase.from("label_prints").insert(
    orders.map((o) => ({
      order_id: o.id,
      market_id: o.market_id,
      printed_by: actor.id,
      batch_id: batchId,
      is_reprint: printedBefore.has(o.id),
      // Their parcel number is the reference; our BL number belongs to the old label.
      bl_number: null,
    })),
  );
  if (error) {
    console.error("[POST /api/warehouse/xdelivery-labels] label_prints insert failed", { code: error.code });
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, "");
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="etiquettes-xdelivery-${stamp}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}

export const GET = withRouteErrors("/api/warehouse/xdelivery-labels", "GET", handleGET);
export const POST = withRouteErrors("/api/warehouse/xdelivery-labels", "POST", handlePOST);
