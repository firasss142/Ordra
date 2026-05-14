import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canPrintLabels } from "@/lib/role-permissions";
import type { Role } from "@/types";
import { renderToBuffer } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import QRCode from "qrcode";
import bwipjs from "bwip-js/node";
import { OrderLabelPdf } from "@/lib/labels/OrderLabelPdf";
import type { OrderLabelData } from "@/lib/labels/OrderLabelPdf";
import React from "react";
import { randomUUID } from "crypto";

export const dynamic = "force-dynamic";

function generateBlNumber(): string {
  // 12-digit numeric BL number. Random — uniqueness enforced by DB index.
  let out = "";
  for (let i = 0; i < 12; i++) out += Math.floor(Math.random() * 10);
  return out;
}

function formatAmount(total: number, currency: string): string {
  const code = currency === "TND" ? "DT" : currency === "LYD" ? "LD" : currency;
  return `${total.toFixed(2)}${code}`;
}

function formatBlDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

async function code128DataUrl(text: string): Promise<string> {
  const png = await bwipjs.toBuffer({
    bcid: "code128",
    text,
    scale: 3,
    height: 14,
    includetext: true,
    textxalign: "center",
    textsize: 10,
    paddingwidth: 0,
    paddingheight: 0,
  });
  return `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
}

export async function POST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canPrintLabels(actor.role as Role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { order_ids?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const orderIds = body.order_ids;
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return NextResponse.json({ error: "Missing order_ids" }, { status: 400 });
  }

  const supabase = await createClient();

  const { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select(
      "id, customer_name, customer_phone, customer_city, customer_address, customer_note, product_name, variant_label, quantity, total_price, market_id, tracking_number, markets(code, currency, sender_name, sender_address, sender_phone)"
    )
    .in("id", orderIds)
    .eq("status", "confirmed");

  if (ordersError) {
    return NextResponse.json({ error: ordersError.message }, { status: 500 });
  }

  if (!orders || orders.length === 0) {
    return NextResponse.json({ error: "No confirmed orders found" }, { status: 404 });
  }

  const batchId = randomUUID();
  const now = new Date();
  const blDateLabel = formatBlDate(now);

  // Assign a unique 12-digit BL number per order. Retry on unique-violation.
  const blByOrder = new Map<string, string>();
  for (const o of orders) {
    let attempts = 0;
    while (attempts < 5) {
      const bl = generateBlNumber();
      const { error } = await supabase.from("label_prints").insert({
        order_id: o.id,
        market_id: o.market_id,
        printed_by: actor.id,
        batch_id: batchId,
        is_reprint: false,
        bl_number: bl,
      });
      if (!error) {
        blByOrder.set(o.id, bl);
        break;
      }
      // 23505 = unique_violation — regenerate; any other error surfaces
      if (error.code !== "23505") {
        return NextResponse.json({ error: error.message }, { status: 422 });
      }
      attempts++;
    }
    if (!blByOrder.has(o.id)) {
      return NextResponse.json(
        { error: "Could not generate unique BL number" },
        { status: 500 }
      );
    }
  }

  const labels: OrderLabelData[] = await Promise.all(
    orders.map(async (o) => {
      const bl = blByOrder.get(o.id)!;
      const trackingNumber: string | null =
        typeof (o as { tracking_number?: string | null }).tracking_number === "string"
          ? ((o as { tracking_number: string }).tracking_number)
          : null;
      const [qrDataUrl, barcodeDataUrl, trackingBarcodeDataUrl] = await Promise.all([
        QRCode.toDataURL(o.id, { width: 220, margin: 1, errorCorrectionLevel: "M" }),
        code128DataUrl(bl),
        // Carrier tracking barcode rendered only after the order has been
        // uploaded — pre-upload prints just skip it.
        trackingNumber ? code128DataUrl(trackingNumber) : Promise.resolve<string | null>(null),
      ]);

      const market = Array.isArray(o.markets) ? o.markets[0] : o.markets;
      const currency = (market as { currency?: string } | null)?.currency ?? "TND";

      const variantPart = o.variant_label ? ` — ${o.variant_label}` : "";
      const designation = `${o.product_name}${variantPart} x ${o.quantity}`;

      return {
        orderId: o.id,
        shortId: o.id.slice(0, 8).toUpperCase(),
        blNumber: bl,
        blDateLabel,
        destinationCity: o.customer_city ?? "—",
        senderName:
          (market as { sender_name?: string } | null)?.sender_name ??
          (market as { name?: string } | null)?.name ??
          "",
        senderAddress:
          (market as { sender_address?: string } | null)?.sender_address ?? "",
        senderPhone:
          (market as { sender_phone?: string } | null)?.sender_phone ?? "",
        customerName: o.customer_name,
        customerPhone: o.customer_phone,
        customerCity: o.customer_city ?? "",
        customerAddress: o.customer_address ?? "",
        items: [
          {
            designation,
            quantity: o.quantity,
            amount: formatAmount(Number(o.total_price ?? 0), currency),
          },
        ],
        instructions: o.customer_note ?? "",
        openPackage: "Non",
        qrDataUrl,
        barcodeDataUrl,
        trackingNumber,
        trackingBarcodeDataUrl,
      };
    })
  );

  const element = React.createElement(OrderLabelPdf, { labels }) as unknown as React.ReactElement<DocumentProps>;
  const pdfBuffer = await renderToBuffer(element);

  return new NextResponse(Buffer.from(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="labels-${batchId.slice(0, 8)}.pdf"`,
      "Content-Length": pdfBuffer.byteLength.toString(),
    },
  });
}
