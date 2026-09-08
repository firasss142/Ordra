/**
 * What a scan-out attempt turned into.
 *
 * Shared by the desk station and the phone sheet so the two can never disagree
 * about what a refusal means. Four outcomes, because they call for four
 * different next acts: `bound` moves on; `refused_here` re-scans; `refused_darb`
 * asks the carrier; `bound_not_committed` is the one that must not read as a
 * plain error, since the parcel IS live at Darb and re-stickering it would bind
 * a second number to a shipment already moving.
 */

export type ScanOutcome = "bound" | "refused_here" | "refused_darb" | "bound_not_committed";

export interface ScanEntry {
  id: string;
  code: string;
  at: string;
  outcome: ScanOutcome;
  from?: number;
  to?: number;
  message?: string;
}

export interface ScanResponse {
  stock_after?: number;
  message?: string;
  error_code?: string;
  error?: string;
  darb_bound?: boolean;
  carrier_status?: string;
}

/** A refusal decided here, before the network. */
export function refusal(code: string, message: string): ScanEntry {
  return { id: `${Date.now()}`, code, at: new Date().toISOString(), outcome: "refused_here", message };
}

/** Which outcome a response represents. Only `bound` is a clean success. */
export function outcomeFor(ok: boolean, body: ScanResponse): ScanOutcome {
  if (ok) return "bound";
  if (body.darb_bound) return "bound_not_committed";
  if (body.error_code === "DARB_BIND_FAILED" || body.error_code === "DARB_SHIPMENT_UNKNOWN") {
    return "refused_darb";
  }
  return "refused_here";
}

/** The `warehouse.scan` key that words a refusal for the operator, or null. */
export function errorLabelKey(code: string | undefined): string | null {
  switch (code) {
    case "STICKER_ALREADY_USED": return "errStickerUsed";
    case "DARB_SHIPMENT_UNKNOWN": return "errShipmentUnknown";
    case "DARB_BIND_FAILED": return "errBindFailed";
    case "NO_LABEL_PRINTED": return "errNoLabel";
    case "INVALID_STATUS": return "errStatus";
    case "MARKET_MISMATCH": return "errMarket";
    case "STOCK_UNDERFLOW": return "errStock";
    case "CARRIER_WAREHOUSE_ORDER": return "errCarrierWarehouse";
    case "ORDER_NOT_FOUND": return "errNotFound";
    case "GONE_AT_CARRIER": return "errGone";
    case "STICKER_NOT_NUMERIC": return "errNotNumeric";
    case "FORBIDDEN": return "errForbidden";
    default: return null;
  }
}
