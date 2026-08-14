// Wire + view types for the AGENT × PRODUCT breakdown on the product sheet.
//
// Deliberately separate from ./product-list.ts. That file describes a PRODUCT
// projection over a period; this one describes an ACTOR projection over the
// orders of one product. They share no field and never travel together.
//
// snake_case throughout, mirroring the JSON exactly, so there is no translation
// layer between wire and type — same convention as product-list.ts.

import type { Role } from "@/types";

/**
 * One actor's contribution to one product over one window.
 *
 * ── THE CLOSING IDENTITY ──────────────────────────────────────────────────
 *   confirmed === delivered + returned + in_flight + other
 * holds on EVERY row, by construction and under test. It is what lets the
 * reading note under the table claim the columns add up. `other` exists purely
 * so the identity closes: it absorbs cancelled, deleted, rejected-after-
 * confirmation, warehouse-returned and any order whose row has since vanished.
 *
 * ── TWO DEFINITIONS OF "DELIVERED" COEXIST ON THE PRODUCT SHEET ──────────
 * The product funnel (lib/products/metrics.ts) counts a delivery from an
 * order_history row `status_to='delivered'` INSIDE the window. The columns
 * below read `orders.status` — the CURRENT state — because that is the only
 * reading under which the identity above closes: an order confirmed in the
 * window has exactly one current status, whereas its history may contain
 * transitions on both sides of the window boundary. Expect the product-level
 * "delivered" and the sum of this column to differ, and say so in the UI.
 */
export interface ProductAgentRow {
  /** `null` for the unattributed bucket — a confirmation whose actor_id was NULL. */
  actor_id: string | null;
  /**
   * `null` when the actor is not readable by the caller. The `users_select`
   * policy scopes a market_manager to its own market and super_admins carry
   * `market_id NULL`, so a Libyan manager cannot read the admin accounts that
   * confirmed a handful of orders. The row is KEPT with a null name — dropping
   * it would break the closing identity for managers while it holds for admins.
   */
  full_name: string | null;
  role: Role | null;

  /** Rows of order_history with status_to in CALL_STATUSES. Attempts, not orders. */
  calls: number;
  /** Distinct orders that received at least one call attempt from this actor. */
  orders_called: number;
  /** Distinct orders this actor acted on at all — see AGENT_ACTION_STATUSES. */
  orders_treated: number;

  /** Orders whose LAST confirmation in the window was posted by this actor. */
  confirmed: number;
  delivered: number;
  returned: number;
  /** Current status is still in the carrier pipeline — see IN_FLIGHT_STATUSES. */
  in_flight: number;
  /** Everything else that was confirmed: cancelled, deleted, rejected after the fact… */
  other: number;
  /** Σ orders.total_price over the DELIVERED orders attributed to this actor. */
  revenue: number;
}

export interface ProductAgentsResponse {
  data: ProductAgentRow[];
  period: { from_date: string; to_date: string };
  /** markets.currency for the product's market. Never derived from the market code. */
  currency: string;
}

/**
 * SUMMING WARNING for anything rolling these rows up.
 *
 * `confirmed`, `delivered`, `returned`, `in_flight`, `other`, `revenue` and
 * `calls` sum exactly: each confirmed order is attributed to exactly one actor,
 * and `calls` counts rows. `orders_called` and `orders_treated` DO NOT: two
 * agents calling the same order both count it, so their column totals
 * over-count the distinct orders touched. A true distinct total has to come
 * from the server, not from adding this column up.
 */
export type ProductAgentSummableKey =
  | "calls"
  | "confirmed"
  | "delivered"
  | "returned"
  | "in_flight"
  | "other"
  | "revenue";
