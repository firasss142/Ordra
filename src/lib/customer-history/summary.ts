/**
 * The figures behind the customer-history panel.
 *
 * Two jobs, both about not lying:
 *
 * 1. `get_customer_history_detail` EXCLUDES the order you are looking at, so a
 *    customer whose current order is delivered comes back with
 *    `delivered_count: 0` and `lifetime_value: 0`. The popover patches the
 *    count with a `+1` and leaves the money alone. Folding the anchor back in
 *    is what makes these figures describe the customer rather than "the
 *    customer, minus the row on screen".
 *
 * 2. Every rate ships with its denominator. One delivered parcel is "100 %" and
 *    so is a hundred; an agent on the phone has to be able to tell them apart.
 */

export interface HistoryRow {
  id: string;
  external_id: string | null;
  created_at: string;
  status: string;
  total_price: number;
  product_name: string | null;
  product_image_url: string | null;
  quantity: number | null;
  /** True for the order the panel was opened from. */
  is_anchor: boolean;
}

/**
 * Confirmed by the customer on the phone, or anything after it. A returned
 * parcel belongs here: the customer did say yes, the delivery is what failed.
 */
const CONFIRMED_OR_BEYOND = new Set([
  "confirmed",
  "dispatch_scheduled",
  "uploaded",
  "scanned",
  "dispatched",
  "deposit",
  "in_transit",
  "at_carrier",
  "out_for_delivery",
  "delivery_delayed",
  "returning",
  "to_be_returned",
  "received",
  "unverified",
  "delivered",
  "returned",
]);

/** Reached a final delivery outcome — the only orders a delivery rate can judge. */
const CONCLUDED = new Set(["delivered", "returned"]);

/**
 * Under this many orders in the denominator, a percentage is noise dressed as a
 * fact. The panel still shows it, but says the base is narrow.
 */
const THIN_EVIDENCE_BELOW = 3;

export interface Ratio {
  /** Numerator — the good outcome. */
  n: number;
  /** Denominator — the orders that could have had it. */
  d: number;
}

export interface TrackRecord {
  deliveredCount: number;
  /** Money actually realised. Never includes a parcel still moving. */
  deliveredValue: number;
  inFlightCount: number;
  inFlightValue: number;
  /** delivered ÷ (delivered + returned). Null when nothing has concluded. */
  delivery: Ratio | null;
  /** confirmed-or-beyond ÷ (that + rejected). Null when nothing was decided. */
  confirmation: Ratio | null;
  /** True when the widest denominator is too small to lean on. */
  isThin: boolean;
}

/**
 * The anchor order plus its history, newest first, de-duplicated by id.
 */
export function mergeAnchorWithHistory(
  anchor: HistoryRow,
  history: HistoryRow[],
): HistoryRow[] {
  const byId = new Map<string, HistoryRow>();
  // Anchor first, so a same-id row from the API cannot overwrite its flag.
  byId.set(anchor.id, { ...anchor, is_anchor: true });
  for (const row of history) {
    if (!byId.has(row.id)) byId.set(row.id, { ...row, is_anchor: false });
  }
  return [...byId.values()].sort((a, b) => {
    const ta = Date.parse(a.created_at);
    const tb = Date.parse(b.created_at);
    if (!Number.isFinite(ta) || !Number.isFinite(tb)) return 0;
    return tb - ta;
  });
}

function price(row: HistoryRow): number {
  const n = Number(row.total_price);
  return Number.isFinite(n) ? n : 0;
}

export function computeTrackRecord(rows: HistoryRow[]): TrackRecord {
  let deliveredCount = 0;
  let deliveredValue = 0;
  let inFlightCount = 0;
  let inFlightValue = 0;
  let concluded = 0;
  let confirmed = 0;
  let rejected = 0;

  for (const row of rows) {
    const s = row.status;

    if (s === "delivered") {
      deliveredCount += 1;
      deliveredValue += price(row);
    }
    if (CONCLUDED.has(s)) concluded += 1;

    if (CONFIRMED_OR_BEYOND.has(s)) {
      confirmed += 1;
      // Committed but not yet concluded — money on the road, not in the till.
      if (!CONCLUDED.has(s)) {
        inFlightCount += 1;
        inFlightValue += price(row);
      }
    }

    if (s === "rejected") rejected += 1;
    // `cancelled` and `deleted` are deliberately in neither denominator: they
    // are our decisions, not the customer's, and counting them would read as
    // the customer refusing.
  }

  const delivery: Ratio | null =
    concluded > 0 ? { n: deliveredCount, d: concluded } : null;

  const decided = confirmed + rejected;
  const confirmation: Ratio | null =
    decided > 0 ? { n: confirmed, d: decided } : null;

  // Judged on the NARROWEST rate on display, not the widest. Both percentages
  // sit side by side, so the weakest one is the one that misleads: a customer
  // can have three decided orders and still show "100 %" drawn from a single
  // concluded parcel. Taking the max would let the strong rate vouch for the
  // weak one.
  const shown = [delivery, confirmation].filter((r): r is Ratio => r !== null);
  const narrowest = shown.length > 0 ? Math.min(...shown.map((r) => r.d)) : null;

  return {
    deliveredCount,
    deliveredValue: Math.round(deliveredValue * 1000) / 1000,
    inFlightCount,
    inFlightValue: Math.round(inFlightValue * 1000) / 1000,
    delivery,
    confirmation,
    isThin: narrowest !== null && narrowest < THIN_EVIDENCE_BELOW,
  };
}

/** Whole-percent rendering of a ratio. */
export function ratioPercent(r: Ratio): number {
  return r.d === 0 ? 0 : Math.round((r.n / r.d) * 100);
}
