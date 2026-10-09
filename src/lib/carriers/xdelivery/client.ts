import type { CarrierConfig } from "../types";
import { XDELIVERY_DEFAULT_ENDPOINT } from "./adapter";

export interface XDeliveryStatusRow {
  barcode: string;
  status: string;
  motif: string | null;
}

/**
 * `POST /parcels/status` — the documented bulk status read. Barcodes it does
 * not know are simply absent from the answer (no error entry), which the poll
 * logs itself. A GET under /api/company answers the web app's HTML with a 200,
 * hence the shape check.
 */
export async function fetchXDeliveryStatuses(
  config: CarrierConfig,
  barcodes: string[],
): Promise<XDeliveryStatusRow[]> {
  const response = await fetch(`${config.apiEndpoint || XDELIVERY_DEFAULT_ENDPOINT}/parcels/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": config.apiCredentials.api_key ?? "" },
    body: JSON.stringify(barcodes),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`X-Delivery status: HTTP ${response.status}`);
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (!Array.isArray(body)) throw new Error("X-Delivery status: unexpected answer (not an array)");
  return body.map((r: Record<string, unknown>) => ({
    barcode: String(r.barcode),
    status: String(r.status ?? ""),
    motif: typeof r.motif === "string" ? r.motif : null,
  }));
}
