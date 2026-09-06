export type TrayRowState = "ready_to_print" | "printed" | "scanned" | "error";

export type ScanErrorCode =
  | "ORDER_NOT_FOUND"
  | "MARKET_MISMATCH"
  | "INVALID_STATUS"
  | "NO_LABEL_PRINTED"
  | "STOCK_UNDERFLOW"
  // Fulfilled from the carrier's own warehouse — never scanned out here.
  | "CARRIER_WAREHOUSE_ORDER"
  // The scanned sticker is already bound to a different parcel.
  | "STICKER_ALREADY_USED"
  // Darb has no shipment for our stored reference, so nothing can be bound.
  | "DARB_SHIPMENT_UNKNOWN"
  // Darb refused the binding, or was unreachable.
  | "DARB_BIND_FAILED"
  // The carrier already reports the parcel as released / completed / returned.
  | "GONE_AT_CARRIER"
  // The scanned payload is not a bare sticker number — a mis-scan.
  | "STICKER_NOT_NUMERIC"
  // The actor's role may not scan at all (defence in depth behind the route guard).
  | "FORBIDDEN"
  | "NETWORK_ERROR";

export interface TrayRowInit {
  id: string;
  shortId: string;
  city: string;
  customer: string;
  productLabel: string;
  quantity: number;
  stockLevel: number;
}

export interface TrayRow extends TrayRowInit {
  state: TrayRowState;
  errorReason?: ScanErrorCode;
  printedAt?: number;
  scannedAt?: number;
}

export function createTrayRow(init: TrayRowInit): TrayRow {
  return { ...init, state: "ready_to_print" };
}

export function markPrinted(row: TrayRow): TrayRow {
  if (row.state === "scanned") return row;
  if (row.state === "printed") return row;
  return { ...row, state: "printed", printedAt: Date.now() };
}

export function markScanned(row: TrayRow, stockAfter: number): TrayRow {
  if (row.state === "scanned") return row;
  if (row.state === "ready_to_print") return row;
  return {
    ...row,
    state: "scanned",
    stockLevel: stockAfter,
    scannedAt: Date.now(),
    errorReason: undefined,
  };
}

export function markError(row: TrayRow, reason: ScanErrorCode): TrayRow {
  if (row.state === "scanned") return row;
  return { ...row, state: "error", errorReason: reason };
}

export function clearError(row: TrayRow): TrayRow {
  if (row.state !== "error") return row;
  return { ...row, state: "printed", errorReason: undefined };
}
