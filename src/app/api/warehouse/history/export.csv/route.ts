import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";
import { warehouseHistoryQuerySchema } from "@/lib/warehouse/list-filters";
import { getWarehouseHistoryPage } from "@/lib/warehouse/history-fetch";
import type { WarehouseHistoryRow } from "@/lib/warehouse/history-fetch";

const EXPORT_LIMIT = 10_000;
const PAGE_SIZE = 200;

function escapeCell(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowToCsv(row: WarehouseHistoryRow): string {
  return [
    row.at,
    row.actor?.full_name ?? "",
    row.actor?.role ?? "",
    row.kind,
    row.order_number ?? "",
    row.product_name ?? "",
    row.qty_change ?? "",
    row.balance_after ?? "",
    row.is_damaged ? "1" : "0",
    row.is_reprint ? "1" : "0",
    row.note ?? "",
    row.anomalies.join("|"),
  ]
    .map(escapeCell)
    .join(",");
}

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parseResult = warehouseHistoryQuerySchema.safeParse(
    Object.fromEntries(req.nextUrl.searchParams.entries()),
  );
  if (!parseResult.success) {
    return NextResponse.json({ error: "Invalid query parameters" }, { status: 400 });
  }

  const supabase = await createClient();
  const scopeMarket = actor.role !== "super_admin" ? actor.market_id : null;

  const allRows: WarehouseHistoryRow[] = [];
  let cursor: string | undefined;

  while (true) {
    const page = await getWarehouseHistoryPage(
      supabase,
      { ...parseResult.data, limit: PAGE_SIZE, cursor },
      scopeMarket,
    );
    allRows.push(...page.rows);

    if (allRows.length >= EXPORT_LIMIT) {
      return NextResponse.json(
        { error: "Too many rows. Narrow your date range before exporting." },
        { status: 400 },
      );
    }

    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }

  const header = "timestamp_iso,actor_name,actor_role,kind,order_number,product_name,qty_change,balance_after,is_damaged,is_reprint,note,anomalies\n";
  const body = allRows.map(rowToCsv).join("\n");
  const csv = header + body;

  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="journal-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
