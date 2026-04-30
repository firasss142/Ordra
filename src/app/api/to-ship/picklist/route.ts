import React from "react";
import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import { getActor } from "@/lib/auth/actor";
import { createClient } from "@/lib/supabase/server";
import { PicklistPdf } from "@/lib/to-ship/PicklistPdf";
import type { PicklistGroup, PicklistLine } from "@/lib/to-ship/PicklistPdf";

const MAX_ORDERS = 200;
const GROUPINGS = ["city", "product", "carrier", "schedule", "status", "none"] as const;
type Grouping = (typeof GROUPINGS)[number];
const SUBGROUPINGS = ["city", "none"] as const;
type Subgrouping = (typeof SUBGROUPINGS)[number];

interface OrderRow {
  id: string;
  customer_name: string;
  customer_city: string | null;
  product_id: string | null;
  product_name: string;
  variant_label: string | null;
  quantity: number;
  total_price: number;
  status: string;
  scheduled_at: string | null;
  scheduled_auto: boolean;
  scheduled_carrier_id: string | null;
}

interface Filters {
  productId: string | null;
  city: string | null;
}

const SCHEDULE_ORDER = ["overdue", "today", "tomorrow", "later", "unscheduled"] as const;
type ScheduleBucket = (typeof SCHEDULE_ORDER)[number];

function startOfUtcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function bucketOf(row: OrderRow, now: Date): ScheduleBucket | null {
  if (row.status !== "dispatch_scheduled" || !row.scheduled_at) {
    if (row.status === "confirmed" || row.status === "scanned") return "unscheduled";
    return null;
  }
  const t = new Date(row.scheduled_at).getTime();
  if (isNaN(t)) return "unscheduled";
  const today = startOfUtcDay(now);
  const tomorrow = today + 24 * 60 * 60 * 1000;
  const dayAfter = tomorrow + 24 * 60 * 60 * 1000;
  if (t < today) return "overdue";
  if (t < tomorrow) return "today";
  if (t < dayAfter) return "tomorrow";
  return "later";
}

const SCHEDULE_LABELS: Record<ScheduleBucket, string> = {
  overdue: "En retard",
  today: "Aujourd'hui",
  tomorrow: "Demain",
  later: "Plus tard",
  unscheduled: "Non planifié",
};

const STATUS_LABELS: Record<string, string> = {
  confirmed: "Confirmée",
  dispatch_scheduled: "Planifiée",
  scanned: "Scannée",
};

export async function POST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (actor.role === "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    order_ids?: unknown;
    grouping?: unknown;
    subgrouping?: unknown;
    filters?: unknown;
  };
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

  const subgroupingRaw = body.subgrouping ?? "none";
  if (
    typeof subgroupingRaw !== "string" ||
    !SUBGROUPINGS.includes(subgroupingRaw as Subgrouping)
  ) {
    return NextResponse.json({ error: "Invalid subgrouping" }, { status: 400 });
  }
  const subgrouping = subgroupingRaw as Subgrouping;

  const filters: Filters = parseFilters(body.filters);

  const supabase = await createClient();
  const { data: orders, error } = await supabase
    .from("orders")
    .select(
      "id, customer_name, customer_city, product_id, product_name, variant_label, quantity, total_price, status, scheduled_at, scheduled_auto, scheduled_carrier_id",
    )
    .in("id", validIds);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!orders || orders.length === 0) {
    return NextResponse.json({ error: "No orders found" }, { status: 404 });
  }

  let rows = orders as OrderRow[];

  let carrierMap = new Map<string, string>();
  if (grouping === "carrier") {
    const carrierIds = [
      ...new Set(rows.map((r) => r.scheduled_carrier_id).filter((x): x is string => !!x)),
    ];
    if (carrierIds.length > 0) {
      const { data: carriers } = await supabase
        .from("carriers")
        .select("id, name")
        .in("id", carrierIds);
      carrierMap = new Map((carriers ?? []).map((c) => [c.id as string, c.name as string]));
    }
  }

  rows = applyFiltersServer(rows, filters);

  if (rows.length === 0) {
    return NextResponse.json({ error: "No orders match the filters" }, { status: 404 });
  }

  const allowSecondary = grouping === "product" || grouping === "carrier";
  const useSubgroup = allowSecondary && subgrouping === "city";

  const groups = buildGroups(rows, grouping as Grouping, useSubgroup, carrierMap);
  const groupingLabel = labelFor(grouping as Grouping, useSubgroup);

  const element = React.createElement(PicklistPdf, {
    title: "Picklist — À expédier",
    subtitle: `${rows.length} orders`,
    generatedAtLabel: new Date().toLocaleString("fr-TN"),
    groupingLabel,
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

function parseFilters(raw: unknown): Filters {
  if (!raw || typeof raw !== "object") return { productId: null, city: null };
  const f = raw as Record<string, unknown>;
  const productId = typeof f.productId === "string" && f.productId ? f.productId : null;
  const city = typeof f.city === "string" && f.city ? f.city : null;
  return { productId, city };
}

function applyFiltersServer(rows: OrderRow[], filters: Filters): OrderRow[] {
  if (!filters.productId && !filters.city) return rows;
  return rows.filter((r) => {
    if (filters.productId && r.product_id !== filters.productId) return false;
    if (filters.city && r.customer_city !== filters.city) return false;
    return true;
  });
}

function labelFor(grouping: Grouping, withCitySub: boolean): string {
  const base: Record<Grouping, string> = {
    city: "Grouped by city",
    product: "Grouped by product",
    carrier: "Grouped by carrier",
    schedule: "Grouped by schedule",
    status: "Grouped by status",
    none: "All orders",
  };
  if (withCitySub) return `${base[grouping]} → city`;
  return base[grouping];
}

function lineFor(o: OrderRow): PicklistLine {
  return {
    shortId: o.id.slice(0, 8).toUpperCase(),
    customerName: o.customer_name,
    customerCity: o.customer_city ?? "—",
    productLabel: `${o.product_name}${o.variant_label ? ` — ${o.variant_label}` : ""}`,
    quantity: o.quantity,
  };
}

function primaryKey(o: OrderRow, grouping: Grouping, now: Date, carrierMap: Map<string, string>): {
  key: string;
  heading: string;
} {
  switch (grouping) {
    case "city": {
      const city = o.customer_city ?? "—";
      return { key: city, heading: city };
    }
    case "product": {
      const heading = `${o.product_name}${o.variant_label ? ` — ${o.variant_label}` : ""}`;
      const key = o.product_id ?? `name:${heading}`;
      return { key, heading };
    }
    case "carrier": {
      const id = o.scheduled_carrier_id;
      if (!id) return { key: "__unassigned__", heading: "Transporteur non assigné" };
      return { key: id, heading: carrierMap.get(id) ?? id };
    }
    case "schedule": {
      const b = bucketOf(o, now) ?? "unscheduled";
      return { key: b, heading: SCHEDULE_LABELS[b] };
    }
    case "status": {
      return { key: o.status, heading: STATUS_LABELS[o.status] ?? o.status };
    }
    case "none":
    default:
      return { key: "all", heading: "Toutes les commandes" };
  }
}

function buildGroups(
  rows: OrderRow[],
  grouping: Grouping,
  withCitySub: boolean,
  carrierMap: Map<string, string>,
): PicklistGroup[] {
  const now = new Date();
  type Bucket = { heading: string; lines: PicklistLine[]; totalQuantity: number; primaryKey: string };
  const map = new Map<string, Bucket>();

  for (const o of rows) {
    const { key: pKey, heading: pHeading } = primaryKey(o, grouping, now, carrierMap);
    const cKey = withCitySub ? o.customer_city ?? "—" : "";
    const compositeKey = withCitySub ? `${pKey}::${cKey}` : pKey;
    const compositeHeading = withCitySub ? `${pHeading} — ${cKey}` : pHeading;
    const existing = map.get(compositeKey);
    const line = lineFor(o);
    if (existing) {
      existing.lines.push(line);
      existing.totalQuantity += o.quantity;
    } else {
      map.set(compositeKey, {
        heading: compositeHeading,
        lines: [line],
        totalQuantity: o.quantity,
        primaryKey: pKey,
      });
    }
  }

  const entries = [...map.values()];
  if (grouping === "schedule") {
    entries.sort((a, b) => {
      const ai = SCHEDULE_ORDER.indexOf(a.primaryKey as ScheduleBucket);
      const bi = SCHEDULE_ORDER.indexOf(b.primaryKey as ScheduleBucket);
      if (ai !== bi) return ai - bi;
      return a.heading.localeCompare(b.heading);
    });
  } else if (grouping === "status") {
    const order = ["confirmed", "dispatch_scheduled", "scanned"];
    entries.sort((a, b) => {
      const ai = order.indexOf(a.primaryKey);
      const bi = order.indexOf(b.primaryKey);
      if (ai !== bi) return ai - bi;
      return a.heading.localeCompare(b.heading);
    });
  } else if (grouping === "carrier") {
    entries.sort((a, b) => {
      if (a.primaryKey === "__unassigned__" && b.primaryKey !== "__unassigned__") return 1;
      if (b.primaryKey === "__unassigned__" && a.primaryKey !== "__unassigned__") return -1;
      return b.lines.length - a.lines.length;
    });
  } else {
    entries.sort((a, b) => b.lines.length - a.lines.length);
  }

  return entries.map((e) => ({
    heading: e.heading,
    count: e.lines.length,
    totalQuantity: e.totalQuantity,
    lines: e.lines,
  }));
}
