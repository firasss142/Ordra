import React from "react";
import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import { getActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { PicklistPdf } from "@/lib/to-ship/PicklistPdf";
import type { PicklistGroup, PicklistLine } from "@/lib/to-ship/PicklistPdf";

const MAX_ORDERS = 200;
const GROUPINGS = ["city", "product"] as const;
type Grouping = (typeof GROUPINGS)[number];

interface OrderRow {
  id: string;
  customer_name: string;
  customer_city: string | null;
  product_name: string;
  variant_label: string | null;
  quantity: number;
  total_price: number;
  status: string;
}

export async function POST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (actor.role === "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { order_ids?: unknown; grouping?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const orderIds = body.order_ids;
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return NextResponse.json({ error: "Missing order_ids" }, { status: 400 });
  }
  if (orderIds.length > MAX_ORDERS) {
    return NextResponse.json(
      { error: `Cannot generate picklist for more than ${MAX_ORDERS} orders` },
      { status: 400 },
    );
  }
  const validIds = orderIds.filter((x): x is string => typeof x === "string" && !!x);
  if (validIds.length === 0) {
    return NextResponse.json({ error: "No valid order_ids" }, { status: 400 });
  }

  const grouping = body.grouping;
  if (typeof grouping !== "string" || !GROUPINGS.includes(grouping as Grouping)) {
    return NextResponse.json({ error: "Invalid grouping" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: orders, error } = await supabase
    .from("orders")
    .select(
      "id, customer_name, customer_city, product_name, variant_label, quantity, total_price, status",
    )
    .in("id", validIds);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!orders || orders.length === 0) {
    return NextResponse.json({ error: "No orders found" }, { status: 404 });
  }

  const rows = orders as OrderRow[];
  const groups = buildGroups(rows, grouping as Grouping);

  const element = React.createElement(PicklistPdf, {
    title: "Picklist — À expédier",
    subtitle: `${rows.length} orders`,
    generatedAtLabel: new Date().toLocaleString("fr-TN"),
    groupingLabel: grouping === "city" ? "Grouped by city" : "Grouped by product",
    groups,
  }) as unknown as React.ReactElement<DocumentProps>;

  const pdf = await renderToBuffer(element);

  return new NextResponse(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="picklist-${Date.now()}.pdf"`,
      "Content-Length": pdf.byteLength.toString(),
    },
  });
}

function buildGroups(rows: OrderRow[], grouping: Grouping): PicklistGroup[] {
  const map = new Map<string, { heading: string; lines: PicklistLine[]; totalQuantity: number }>();
  for (const o of rows) {
    const key =
      grouping === "city"
        ? o.customer_city ?? "—"
        : o.product_name + (o.variant_label ? ` — ${o.variant_label}` : "");
    const heading = key;
    const existing = map.get(key);
    const line: PicklistLine = {
      shortId: o.id.slice(0, 8).toUpperCase(),
      customerName: o.customer_name,
      customerCity: o.customer_city ?? "—",
      productLabel: `${o.product_name}${o.variant_label ? ` — ${o.variant_label}` : ""}`,
      quantity: o.quantity,
    };
    if (existing) {
      existing.lines.push(line);
      existing.totalQuantity += o.quantity;
    } else {
      map.set(key, { heading, lines: [line], totalQuantity: o.quantity });
    }
  }
  return [...map.entries()]
    .map(([, v]) => ({ heading: v.heading, count: v.lines.length, totalQuantity: v.totalQuantity, lines: v.lines }))
    .sort((a, b) => b.count - a.count);
}
