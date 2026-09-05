import type { SheetsRowAdapter } from "./types";
import type { InternalOrderData } from "@/lib/storefronts/types";
import { PayloadMappingError } from "@/lib/storefronts/errors";
import { parseDecimal } from "@/lib/storefronts/payload-guards";

// Matches "Product Name x N" — the Converty Products column format.
const PRODUCTS_PATTERN = /^(.+?)\s+x\s*(\d+)$/;

/**
 * Produces a stable, slug-style external_variant_id from a product name so
 * that the product resolver's explicit-mapping path can be used for sheet
 * orders. Without this, external_variant_id would be null and sheet orders
 * would never appear in the /mappings review surface — only the fragile
 * name-ILIKE fallback would fire.
 *
 * The slug is deterministic: same product name → same key across every sync.
 * It preserves non-ASCII characters (Arabic) so Arabic product names produce
 * readable, unique slugs rather than collapsing to empty strings.
 */
function toProductSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")   // collapse whitespace to single dash
    .replace(/-{2,}/g, "-") // collapse consecutive dashes
    .replace(/^-|-$/g, ""); // strip leading/trailing dashes
}

/**
 * customer_name for a Converty row whose Name cell is empty. A visible marker
 * rather than the phone number, so the agent queue reads "no name yet" and not
 * a customer literally called 914009883.
 */
export const MISSING_CUSTOMER_NAME = "—";

/** The one Converty status that is not an order: the merchant removed it. */
const SKIPPED_STATUSES = new Set(["deleted"]);

export class ConvertySheetsAdapter implements SheetsRowAdapter {
  readonly platform = "converty";

  /**
   * Converty's Status column is `pending` | `abandoned` | `deleted`. Only
   * `deleted` is left out — `abandoned` means the customer stopped at checkout
   * and is still a lead agents call. Matched case- and whitespace-insensitively
   * because the sheet is hand-exported.
   */
  skipReason(row: Record<string, string>): string | null {
    const status = row["Status"]?.trim().toLowerCase() ?? "";
    return SKIPPED_STATUSES.has(status) ? `Converty status is '${status}'` : null;
  }

  mapRow(row: Record<string, string>): InternalOrderData {
    const externalId = row["QR Code"]?.trim();
    if (!externalId) throw new PayloadMappingError("Missing QR Code");

    // A blank Name is a lead, not an error. Converty exports a real share of
    // checkouts without one (218 of 3,885 rows on the live sheet, 5 in one
    // two-day window) and the phone — the thing the agent actually calls — is
    // present. Rejecting these silently dropped paying customers for weeks
    // with nobody alerted. The placeholder is visibly "no name" so the agent
    // asks for it on the call.
    const customerName = row["Name"]?.trim() || MISSING_CUSTOMER_NAME;

    const rawPhone = row["Phone"]?.trim();
    if (!rawPhone) throw new PayloadMappingError("Missing customer phone");
    const customerPhone = rawPhone;

    const totalPrice = parseDecimal(row["Total Price"]);
    if (totalPrice === undefined) {
      throw new PayloadMappingError("Missing or invalid Total Price");
    }

    const { productName, quantity } = parseProducts(
      row["Products"] ?? "",
      row["Quantity"] ?? ""
    );

    const unitPrice = quantity > 0 ? totalPrice / quantity : totalPrice;

    return {
      external_id: externalId,
      external_platform: "converty",
      customer_name: customerName,
      customer_phone: customerPhone,
      customer_city: row["City"]?.trim() || null,
      customer_address: row["Address"]?.trim() || null,
      // "abandoned" in Converty means customer started checkout but didn't
      // complete it. OMS treats these as pending — agents call them like any
      // other order. The Status column is intentionally ignored here.
      customer_note: row["Note"]?.trim() || null,
      dexpress_state_id: null,
      product_name: productName,
      sku: null,
      variant_label: null,
      quantity,
      unit_price: unitPrice,
      total_price: totalPrice,
      external_product_id: null,
      external_variant_id: toProductSlug(productName),
      external_city_id: null,
      external_route_id: null,
      currency: null,
    };
  }
}

function parseProducts(
  products: string,
  quantityFallback: string
): { productName: string; quantity: number } {
  const trimmed = products.trim();
  if (!trimmed) throw new PayloadMappingError("Missing product name");

  const match = PRODUCTS_PATTERN.exec(trimmed);
  if (match) {
    const qty = parseInt(match[2], 10);
    return {
      productName: match[1].trim(),
      quantity: qty > 0 ? qty : 1,
    };
  }

  const fallbackQty = parseInt(quantityFallback, 10);
  return {
    productName: trimmed,
    quantity: fallbackQty > 0 ? fallbackQty : 1,
  };
}
