import type { Role } from "../types";
import type { OrderStatus } from "../types/order-status";
import { canTransition } from "../types/order-status";

export function canViewOrders(
  role: Role,
  targetMarketId: string,
  actorMarketId: string
): boolean {
  if (role === "super_admin") return true;
  if (role === "market_manager") return targetMarketId === actorMarketId;
  if (role === "agent") return targetMarketId === actorMarketId;
  if (role === "warehouse_agent") return targetMarketId === actorMarketId;
  return false;
}

export function canCreateOrders(
  role: Role,
  targetMarketId: string,
  actorMarketId: string
): boolean {
  if (role === "super_admin") return true;
  if (role === "market_manager") return targetMarketId === actorMarketId;
  if (role === "agent") return targetMarketId === actorMarketId;
  return false;
}

export function canAssignOrders(
  role: Role,
  targetMarketId: string,
  actorMarketId: string
): boolean {
  if (role === "super_admin") return true;
  if (role === "market_manager") return targetMarketId === actorMarketId;
  return false;
}

export function canCancelOrder(
  role: Role,
  targetMarketId?: string,
  actorMarketId?: string
): boolean {
  if (role === "super_admin") return true;
  if (role === "market_manager") {
    if (targetMarketId !== undefined && actorMarketId !== undefined) {
      return targetMarketId === actorMarketId;
    }
    return true;
  }
  return false;
}

/**
 * Whether a role may recover (un-delete) a soft-deleted order. Same scope as
 * cancel/delete: super_admin anywhere, market_manager only within their own
 * market, agents never. The recovery RPC re-checks this server-side.
 */
export function canRecoverDeletedOrder(
  role: Role,
  targetMarketId?: string,
  actorMarketId?: string
): boolean {
  if (role === "super_admin") return true;
  if (role === "market_manager") {
    if (targetMarketId !== undefined && actorMarketId !== undefined) {
      return targetMarketId === actorMarketId;
    }
    return true;
  }
  return false;
}

/**
 * Whether a role may delete a DUPLICATE SIBLING order from the duplicate dialog.
 * This is the market-scope HALF of the gate — agents are allowed here even
 * though `canCancelOrder` excludes them, because this power is narrowly scoped:
 * the server independently re-verifies (via the duplicate RPC) that the target
 * really is a sibling before any delete. The genuine-sibling half is enforced
 * in lib/orders/duplicate-delete.ts, never here.
 */
export function canDeleteDuplicateSibling(
  role: Role,
  targetMarketId: string,
  actorMarketId: string
): boolean {
  if (role === "super_admin") return true;
  if (role === "market_manager") return targetMarketId === actorMarketId;
  if (role === "agent") return targetMarketId === actorMarketId;
  return false;
}

export const MANUAL_DELETE_ORDER_STATUSES: ReadonlySet<OrderStatus> = new Set([
  "pending",
  "assigned",
  "attempt_1",
  "attempt_2",
  "attempt_3",
  "callback_scheduled",
  "confirmed",
  "dispatch_scheduled",
  "uploaded",
  "scanned",
]);

export function canManuallyDeleteOrderStatus(status: string): status is OrderStatus {
  return MANUAL_DELETE_ORDER_STATUSES.has(status as OrderStatus);
}

/**
 * Statuses the duplicate DIALOG is allowed to remove. NARROWER than
 * MANUAL_DELETE_ORDER_STATUSES on purpose: it excludes `uploaded` (committed to
 * the carrier) and `scanned` (stock deducted). Removing those would void the
 * carrier shipment / restore stock — too destructive for the dialog. An
 * `uploaded` order is pulled back via barcode deletion (carrier-delete route),
 * not removed here. The manager's general cancel still uses the wider set.
 */
export const DUPLICATE_DIALOG_DELETE_STATUSES: ReadonlySet<OrderStatus> = new Set([
  "pending",
  "assigned",
  "attempt_1",
  "attempt_2",
  "attempt_3",
  "callback_scheduled",
  "confirmed",
  "dispatch_scheduled",
]);

export function canDeleteDuplicateSiblingStatus(status: string): status is OrderStatus {
  return DUPLICATE_DIALOG_DELETE_STATUSES.has(status as OrderStatus);
}

// Statuses that agents are allowed to transition TO
const AGENT_ALLOWED_TARGETS: Set<OrderStatus> = new Set([
  "attempt_1",
  "attempt_2",
  "attempt_3",
  "callback_scheduled",
  "confirmed",
  "dispatch_scheduled",
  "uploaded",
  "rejected",
]);

export function canUpdateFulfillment(role: Role): boolean {
  return role === "super_admin" || role === "market_manager";
}

const AGENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const REOPENABLE_STATUSES = new Set<string>(["rejected", "uploaded", "dispatched"]);

export const EDIT_BLOCKED_STATUSES: ReadonlySet<string> = new Set([
  "uploaded",
  "scanned",
  "dispatched",
  "deposit",
  "in_transit",
  "to_be_returned",
  "delivered",
  "returned",
  "cancelled",
  "deleted",
]);

const EDIT_WINDOWED_STATUSES = new Set<string>(["rejected", "confirmed"]);

/**
 * An `uploaded` order whose carrier reference (barcode) was deleted and that no
 * longer carries a tracking number has effectively been pulled back from the
 * carrier. It behaves like a `confirmed` order awaiting (re-)upload: the agent
 * can edit it again and re-run the call flow. This is the ONLY way an uploaded
 * order becomes editable for an agent.
 */
export function isReferenceDeletedUpload(order: {
  status: string;
  tracking_number?: string | null;
  carrier_barcode_deleted_at?: string | null;
}): boolean {
  return (
    order.status === "uploaded" &&
    !order.tracking_number &&
    Boolean(order.carrier_barcode_deleted_at)
  );
}

export function canReopenOrder(
  role: Role,
  actorId: string,
  order: { status: string; assigned_to: string | null; updated_at: string },
  now: Date = new Date(),
): boolean {
  if (role !== "agent") return false;
  if (order.assigned_to !== actorId) return false;
  if (!REOPENABLE_STATUSES.has(order.status)) return false;
  const updatedAt = new Date(order.updated_at);
  return now.getTime() - updatedAt.getTime() <= AGENT_WINDOW_MS;
}

// Statuses where ending a call (no-answer / confirm / reject / callback) is a
// meaningful action — the pre-confirm pool. A reference-deleted upload rejoins
// this pool. Confirmed / scheduled-dispatch are intentionally excluded: their
// next step is a single-order upload, not a batchable call.
const CALL_POOL_STATUSES = new Set<string>([
  "pending",
  "assigned",
  "attempt_1",
  "attempt_2",
  "attempt_3",
  "callback_scheduled",
]);

/**
 * Whether an order can take part in the agent's bulk "Start calls" batch.
 * Drives which cards expose a selection checkbox so the bulk bar can never
 * queue an order the post-call sheet can't act on.
 */
export function isBulkCallEligible(order: {
  status: string;
  tracking_number?: string | null;
  carrier_barcode_deleted_at?: string | null;
}): boolean {
  return CALL_POOL_STATUSES.has(order.status) || isReferenceDeletedUpload(order);
}

export function canEditOrder(
  role: Role,
  actorId: string,
  order: {
    status: string;
    assigned_to: string | null;
    updated_at: string;
    tracking_number?: string | null;
    carrier_barcode_deleted_at?: string | null;
  },
  now: Date = new Date(),
): boolean {
  if (role === "super_admin" || role === "market_manager") return true;
  if (role !== "agent") return false;
  if (order.assigned_to !== actorId) return false;
  // A reference-deleted upload is back in the agent's hands like a confirmed
  // order — editable again — even though `uploaded` is otherwise edit-blocked.
  if (isReferenceDeletedUpload(order)) return true;
  if (EDIT_BLOCKED_STATUSES.has(order.status)) return false;
  if (EDIT_WINDOWED_STATUSES.has(order.status)) {
    return now.getTime() - new Date(order.updated_at).getTime() <= AGENT_WINDOW_MS;
  }
  return true;
}

export function canTransitionOrder(
  role: Role,
  from: OrderStatus,
  to: OrderStatus
): boolean {
  // First: must be a valid graph transition
  if (!canTransition(from, to)) return false;

  // Super admin can do all valid transitions
  if (role === "super_admin") return true;

  // Market manager can do all valid transitions
  if (role === "market_manager") return true;

  // Agent: restricted to AGENT_ALLOWED_TARGETS
  if (role === "agent") return AGENT_ALLOWED_TARGETS.has(to);

  return false;
}
