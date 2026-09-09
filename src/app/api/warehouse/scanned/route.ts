import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canScanWarehouse } from "@/lib/role-permissions";
import { resolveWarehouseScope } from "@/lib/warehouse/scope";
import { resolveSiteFilter } from "@/lib/warehouse/site-scope";
import { attachProductImages } from "@/lib/warehouse/product-images";
import { getZoneIndex } from "@/lib/warehouse/zone-index-cache";
import { zoneForOrder, type OrderZone } from "@/lib/warehouse/zone-index";
import type { StickerBindState } from "@/lib/carriers/darb-assabil-reference";

export const dynamic = "force-dynamic";

/**
 * What happened to the parcels we already scanned.
 *
 * Until now a scanned parcel vanished: no list, no recheck, no way back. Yet of
 * the 20 scanned on 2026-09-08, eight had a real problem — seven re-stickered
 * by Darb's reception, one never registered at all — and every one of them was
 * invisible on screen.
 *
 * Two moments live here, because the agent can still act on both:
 *   scanned    — stickered, on the bench, waiting for the carrier to collect
 *   at_carrier — collected; nothing to do but confirm the number stuck
 */

export interface ScannedRow {
  id: string;
  customer_name: string;
  customer_phone: string | null;
  customer_city: string | null;
  customer_area: string | null;
  product_id: string | null;
  product_name: string;
  variant_label: string | null;
  quantity: number;
  total_price: number;
  status: "scanned" | "at_carrier";
  created_at: string;
  scanned_at: string | null;
  scanned_by_name: string | null;
  tracking_number: string | null;
  carrier_sticker_ref: string | null;
  carrier_status_slug: string | null;
  sticker_bind_state: StickerBindState | null;
  /** What Darb holds instead of our sticker. Present when not confirmed. */
  carrier_reference_actual: string | null;
  branch_group: string | null;
  warehouse_id: string | null;
  carrier_name: string | null;
  current_stock: number | null;
  low_stock_threshold: number | null;
  product_image_url?: string | null;
  zone: OrderZone;
}

export interface ScannedPage {
  orders: ScannedRow[];
  nextCursor: string | null;
  /** Waiting on the bench for the carrier. */
  awaitingPickup: number;
  /** Already collected. */
  atCarrier: number;
  /** Darb is not holding our number on these. The reason this list exists. */
  unconfirmed: number;
  warehouseId: string | null;
  sitePinned: boolean;
  /** A warehouse agent nobody has assigned to a building yet: they see nothing. */
  siteUnassigned: boolean;
}

function encodeCursor(row: { scanned_at: string | null; created_at: string; id: string }): string {
  return Buffer.from(`${row.scanned_at ?? row.created_at}|${row.id}`).toString("base64url");
}

function decodeCursor(raw: string | null): { at: string; id: string } | null {
  if (!raw) return null;
  try {
    const [at, id] = Buffer.from(raw, "base64url").toString("utf8").split("|");
    return at && id ? { at, id } : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canScanWarehouse(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { marketId } = resolveWarehouseScope(req, actor);
  const site = await resolveSiteFilter(supabase, {
    actor,
    requested: req.nextUrl.searchParams.get("warehouse_id"),
  });

  const limitRaw = Number(req.nextUrl.searchParams.get("limit") ?? 100);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 100;
  const cursor = decodeCursor(req.nextUrl.searchParams.get("cursor"));

  /*
   * No building, no list. Same reasoning as the bench queue: showing an
   * unassigned agent both buildings is how a parcel gets un-scanned or
   * re-stickered from the wrong site.
   */
  if (site.unassigned) {
    const empty: ScannedPage = {
      orders: [],
      nextCursor: null,
      awaitingPickup: 0,
      atCarrier: 0,
      unconfirmed: 0,
      warehouseId: null,
      sitePinned: true,
      siteUnassigned: true,
    };
    return NextResponse.json(empty, {
      headers: { "Cache-Control": "private, max-age=2, stale-while-revalidate=30" },
    });
  }

  const [{ data, error }, zoneIndex] = await Promise.all([
    supabase.rpc("get_scanned_orders", {
      p_market_id: marketId,
      p_warehouse_id: site.warehouseId,
      p_limit: limit + 1,
      p_cursor_scanned_at: cursor?.at ?? null,
      p_cursor_id: cursor?.id ?? null,
    }),
    getZoneIndex(supabase),
  ]);

  if (error) {
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  const rows = (data ?? []) as ScannedRow[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const pictured = await attachProductImages(supabase, page as never);
  const orders = (pictured as unknown as ScannedRow[]).map((row) => ({
    ...row,
    zone: zoneForOrder(row, zoneIndex),
  }));

  const body: ScannedPage = {
    orders,
    nextCursor: hasMore && page.length > 0 ? encodeCursor(page[page.length - 1]) : null,
    awaitingPickup: orders.filter((o) => o.status === "scanned").length,
    atCarrier: orders.filter((o) => o.status === "at_carrier").length,
    unconfirmed: orders.filter(
      (o) => o.sticker_bind_state != null && o.sticker_bind_state !== "confirmed",
    ).length,
    warehouseId: site.warehouseId,
    sitePinned: site.pinned,
    siteUnassigned: false,
  };

  return NextResponse.json(body, {
    headers: { "Cache-Control": "private, max-age=2, stale-while-revalidate=30" },
  });
}
