import { resolveDarbAny } from "./darb-assabil-areas";

/**
 * Per-order eligibility for BULK upload to a carrier. Pure: the route does all
 * IO (fetching orders, carrier, the Darb default service, and the
 * darb_destinations rows) and hands the resolved context in, so this function —
 * and the whole skip/eligible matrix — is unit-testable without Supabase.
 *
 * Destination resolution mirrors the cron auto-dispatch
 * (src/app/api/cron/dispatch-scheduled/route.ts): the persisted
 * darb_destination_id → darb_destinations(city, area) is authoritative (it's
 * what the agent picked, and it resolves multi-area cities); resolveDarbAny on
 * the raw city is only the fallback when none was persisted. Because resolution
 * succeeds only for served destinations, it doubles as the coverage gate — no
 * separate coverage check is needed (and checking coverage on a manually-picked
 * destination would falsely skip it).
 */
export type SkipReason =
  | "order_not_found"
  | "wrong_status"
  | "wrong_market"
  | "no_destination"
  | "no_state"
  | "no_service"
  | "missing_address"
  | "unknown_carrier";

export interface PreflightOrder {
  id: string;
  status: string;
  market_id: string;
  customer_city: string | null;
  customer_address: string | null;
  dexpress_state_id: number | null;
}

export interface PreflightCarrier {
  code: string;
  market_id: string;
}

export interface PreflightContext {
  /**
   * The (city, area) resolved from this order's persisted darb_destination_id,
   * or null when none was persisted (then we fall back to the city string).
   */
  darbDestination: { city: string; area: string } | null;
  /** Default Darb service id sourced from darb_services (is_default). */
  defaultDarbServiceId: string | null;
}

export type PreflightResult =
  | { eligible: true; extra: Record<string, unknown> | undefined }
  | { eligible: false; reason: SkipReason };

/** Statuses an order can be uploaded from (matches the single-dispatch route). */
const DISPATCHABLE_STATUSES = new Set(["confirmed", "dispatch_scheduled"]);

export function resolveOrderDispatch(
  order: PreflightOrder | undefined,
  carrier: PreflightCarrier,
  ctx: PreflightContext,
): PreflightResult {
  if (!order) return { eligible: false, reason: "order_not_found" };

  // Gate order before destination so the reason is stable and cheap.
  if (!DISPATCHABLE_STATUSES.has(order.status)) {
    return { eligible: false, reason: "wrong_status" };
  }
  if (carrier.market_id !== order.market_id) {
    return { eligible: false, reason: "wrong_market" };
  }

  switch (carrier.code) {
    case "darb_assabil": {
      if (!order.customer_address?.trim()) {
        return { eligible: false, reason: "missing_address" };
      }
      // Authoritative persisted pair first, else resolve from the city string.
      let pair = ctx.darbDestination;
      if (!pair) {
        const resolved = resolveDarbAny(order.customer_city);
        // null → unknown city; area === null → multi-area city needing a manual
        // pick. Both can't be bulk-dispatched.
        if (!resolved || resolved.area == null) {
          return { eligible: false, reason: "no_destination" };
        }
        pair = { city: resolved.city, area: resolved.area };
      }
      // Carrier rows carry an empty default_service_id, so the adapter would
      // throw without a service id — the batch must supply one.
      if (!ctx.defaultDarbServiceId) {
        return { eligible: false, reason: "no_service" };
      }
      return {
        eligible: true,
        extra: {
          city: pair.city,
          customer_area: pair.area,
          service_id: ctx.defaultDarbServiceId,
          // Bulk uses the free default (men's) service → fees not billed on top.
          service_fee_on_top: false,
        },
      };
    }

    case "dexpress": {
      if (order.dexpress_state_id == null) {
        return { eligible: false, reason: "no_state" };
      }
      return { eligible: true, extra: { state_id: order.dexpress_state_id } };
    }

    case "navex":
      // Navex builds its payload from the order's own fields — no extra needed.
      return { eligible: true, extra: undefined };

    default:
      return { eligible: false, reason: "unknown_carrier" };
  }
}
