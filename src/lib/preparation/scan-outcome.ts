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

export type ScanOutcome =
  | "bound"
  | "refused_here"
  | "refused_darb"
  | "bound_not_committed"
  /*
   * Committed here, NOT confirmed at the carrier: Darb accepted the PATCH twice
   * and is still holding a different reference. The parcel leaves anyway (their
   * reception re-scans the sticker at booking and recovers it), so this is a
   * success with a warning, not a refusal — the agent takes the next parcel,
   * and the number Darb holds is named so the problem is not invisible.
   */
  | "bind_unverified";

export interface ScanEntry {
  id: string;
  code: string;
  at: string;
  outcome: ScanOutcome;
  from?: number;
  to?: number;
  message?: string;
  /** The reference Darb is holding, when it is not ours. */
  carrierRef?: string;
}

export interface ScanResponse {
  stock_after?: number;
  /**
   * One entry per product the scan moved, from `scan_order_out`.
   *
   * A parcel can hold several different products, and `orders.quantity` is only
   * the denormalised first line — so the movement of the primary product cannot
   * be derived from it. The server states it.
   */
  movements?: Array<{ product_id: string | null; change: number; stock_after: number }>;
  /** What Darb is holding instead of our sticker, on an unverified bind. */
  carrier_reference?: string;
  /** "confirmed" | "restickered" | "not_registered" | "unknown". */
  sticker_bind_state?: string | null;
  message?: string;
  error_code?: string;
  error?: string;
  darb_bound?: boolean;
  carrier_status?: string;
  /**
   * On WRONG_SITE: the building the parcel belongs to. The message is useless
   * without it — "wrong building" leaves the agent holding a parcel with no
   * idea which shelf it came from.
   */
  warehouse_name?: string;
}

/** A refusal decided here, before the network. */
export function refusal(code: string, message: string): ScanEntry {
  return { id: `${Date.now()}`, code, at: new Date().toISOString(), outcome: "refused_here", message };
}

/** Which outcome a response represents. Only `bound` is a clean success. */
export function outcomeFor(ok: boolean, body: ScanResponse): ScanOutcome {
  if (ok) {
    // A committed scan the carrier did not confirm is still a committed scan.
    return body.sticker_bind_state && body.sticker_bind_state !== "confirmed"
      ? "bind_unverified"
      : "bound";
  }
  // Checked before `darb_bound`: this response carries darb_bound too, but the
  // sticker did NOT stick, so the two call for opposite next acts — re-scan
  // here, never "the parcel is live, leave it alone".
  if (body.error_code === "BIND_UNVERIFIED") return "bind_unverified";
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
    case "BIND_UNVERIFIED": return "errBindUnverified";
    case "FORBIDDEN": return "errForbidden";
    case "WRONG_SITE": return "errWrongSite";
    case "NO_SITE_ASSIGNED": return "errNoSite";
    default: return null;
  }
}
