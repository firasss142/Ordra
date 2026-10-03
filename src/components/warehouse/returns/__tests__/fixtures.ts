/**
 * Rows shaped like GET /api/warehouse/returns. TEST ONLY.
 * Names and cities follow the prototype's Benghazi day (fictional first names).
 */
import type { OnTheWayRow, ProcessedRow, ReturnRow } from "@/app/api/warehouse/returns/returns-data";

const HOUR = 3_600_000;

export function atDarb(id: string, over: Partial<ReturnRow> & { hoursAtDarb?: number } = {}): ReturnRow {
  const { hoursAtDarb = 96, ...rest } = over;
  return {
    id,
    customer_name: "سعاد المبروك",
    customer_phone: "0940",
    customer_city: "طبرق",
    customer_area: null,
    customer_address: null,
    product_id: "p-qr",
    product_name: "مصحف القرآن تدبر وعمل",
    variant_label: null,
    quantity: 1,
    total_price: 120,
    status: "to_be_returned",
    created_at: new Date(Date.now() - 12 * 24 * HOUR).toISOString(),
    uploaded_at: null,
    branch_group: null,
    tracking_number: `SH${id}`,
    carrier_sticker_ref: null,
    carrier_status_slug: null,
    has_carrier_ref: null,
    current_stock: null,
    low_stock_threshold: null,
    returned_at: new Date(Date.now() - hoursAtDarb * HOUR).toISOString(),
    product_image_url: null,
    warehouse_id: "w-ben",
    warehouse_name: "بنغازي",
    darb_reason: "refused",
    ...rest,
  } as ReturnRow;
}

export function onTheWay(id: string, over: Partial<OnTheWayRow> = {}): OnTheWayRow {
  return {
    id,
    product_id: "p-qr",
    product_name: "مصحف القرآن تدبر وعمل",
    variant_label: null,
    quantity: 1,
    customer_city: "سرت",
    warehouse_id: "w-ben",
    warehouse_name: "بنغازي",
    product_image_url: null,
    ...over,
  };
}

export function processed(id: string, over: Partial<ProcessedRow> = {}): ProcessedRow {
  return {
    id,
    product_id: "p-qr",
    product_name: "كتاب الداء والدواء",
    variant_label: null,
    quantity: 1,
    customer_name: "علي",
    customer_city: "درنة",
    tracking_number: `SH${id}`,
    carrier_sticker_ref: null,
    warehouse_id: "w-ben",
    warehouse_name: "بنغازي",
    outcome: "restocked",
    return_reason: null,
    processed_at: new Date(Date.now() - 26 * HOUR).toISOString(),
    ...over,
  };
}

/** A fetch double that answers every call with `body`. */
export function stubFetch(body: unknown, ok = true) {
  return async () => ({ ok, status: ok ? 200 : 422, json: async () => body }) as unknown as Response;
}
