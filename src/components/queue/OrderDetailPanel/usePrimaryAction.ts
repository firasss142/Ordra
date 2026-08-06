import { useMemo } from "react";
import { canReopenOrder, isReferenceDeletedUpload } from "@/lib/order-permissions";
import type {
  PanelAction,
  PanelActions,
  PrimaryActionInputs,
} from "./types";

const TERMINAL_STATUSES = new Set([
  "delivered",
  "returned",
  "cancelled",
  "deleted",
]);

const IN_CONFIRMATION_STATUSES = new Set([
  "pending",
  "assigned",
  "attempt_1",
  "attempt_2",
  "attempt_3",
  "callback_scheduled",
]);

const PRE_DISPATCH_CANCELLABLE = new Set([
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

const FULFILLMENT_OVERRIDE_STATUSES = new Set([
  "scanned",
  "dispatched",
  "deposit",
  "in_transit",
]);

function isManagerish(role: PrimaryActionInputs["role"]): boolean {
  return role === "market_manager" || role === "super_admin";
}

function reopenable(input: PrimaryActionInputs): boolean {
  if (input.role !== "agent" && input.role !== undefined) return false;
  if (!input.userId) return false;
  return canReopenOrder(
    "agent",
    input.userId,
    {
      status: input.order.status,
      assigned_to: input.order.assigned_to,
      updated_at: input.order.updated_at,
    },
    input.now ?? new Date(),
  );
}

/**
 * Pure resolver — exported for tests. The hook just memoizes around it.
 * Maps (status, role, userId, order flags) → primary CTA + overflow items.
 * Every kind here maps 1:1 to a translation key under `orders.detail.actions.*`.
 */
export function resolvePanelActions(input: PrimaryActionInputs): PanelActions {
  const { order, role, hasActiveCarrier, canReturnToPool } = input;
  const status = order.status;

  // A reference-deleted upload behaves like `confirmed` for action purposes.
  const isRefDeletedUpload = isReferenceDeletedUpload({
    status: order.status,
    tracking_number: order.tracking_number,
    carrier_barcode_deleted_at: order.carrier_barcode_deleted_at,
  });
  const effectiveStatus = isRefDeletedUpload ? "confirmed" : status;

  // ── Group A: In-confirmation ────────────────────────────────────────────
  if (IN_CONFIRMATION_STATUSES.has(effectiveStatus)) {
    const overflow: PanelAction[] = [];
    if (effectiveStatus === "callback_scheduled") {
      overflow.push({ kind: "rescheduleCallback", labelKey: "actions.rescheduleCallback" });
    }
    if ((role === "agent" || role === undefined) && canReturnToPool) {
      overflow.push({ kind: "returnToPool", labelKey: "actions.returnToPool" });
    }
    if (isManagerish(role)) {
      overflow.push({ kind: "cancel", labelKey: "actions.cancel", destructive: true });
    }
    return {
      primary: { kind: "endCall", labelKey: "actions.endCall" },
      overflow,
    };
  }

  // ── Group B: Awaiting upload (confirmed + dispatch_scheduled + ref-deleted) ──
  if (effectiveStatus === "confirmed") {
    const overflow: PanelAction[] = [];
    overflow.push({ kind: "scheduleDispatch", labelKey: "actions.scheduleDispatch" });
    if (role === "agent" || role === undefined || isManagerish(role)) {
      overflow.push({ kind: "changeStatus", labelKey: "actions.changeStatus" });
    }
    if (isManagerish(role)) {
      overflow.push({ kind: "cancel", labelKey: "actions.cancel", destructive: true });
    }
    return {
      primary: {
        kind: "uploadToCarrier",
        labelKey: "actions.uploadToCarrier",
        disabled: !hasActiveCarrier,
        disabledReasonKey: hasActiveCarrier ? undefined : "actions.primaryDisabledNoCarrier",
      },
      overflow,
    };
  }

  if (status === "dispatch_scheduled") {
    const overflow: PanelAction[] = [
      { kind: "cancelSchedule", labelKey: "actions.cancelSchedule" },
    ];
    if (isManagerish(role)) {
      overflow.push({ kind: "cancel", labelKey: "actions.cancel", destructive: true });
    }
    return {
      primary: {
        kind: "uploadNow",
        labelKey: "actions.uploadNow",
        disabled: !hasActiveCarrier,
        disabledReasonKey: hasActiveCarrier ? undefined : "actions.primaryDisabledNoCarrier",
      },
      overflow,
    };
  }

  // ── Group C: Uploaded (with tracking) + fulfillment-stage statuses ──────
  // When the order is reopenable (agent within the 7-day window), reopen
  // takes over the primary CTA — it's the meaningful next action and used
  // to be the loud green button before the redesign.
  if (status === "uploaded") {
    const overflow: PanelAction[] = [];
    // Destructive: this cancels the shipment with the carrier. The flag keeps
    // it in the overflow menu rather than promoted beside the primary CTA.
    overflow.push({
      kind: "deleteCarrierBarcode",
      labelKey: "actions.deleteCarrierBarcode",
      destructive: true,
    });
    if (isManagerish(role)) {
      overflow.push({ kind: "cancel", labelKey: "actions.cancel", destructive: true });
    }
    return {
      primary: reopenable(input)
        ? { kind: "reopen", labelKey: "actions.reopen" }
        : { kind: "close", labelKey: "actions.close" },
      overflow,
    };
  }

  if (FULFILLMENT_OVERRIDE_STATUSES.has(status)) {
    const overflow: PanelAction[] = [];
    if (isManagerish(role)) {
      overflow.push({ kind: "fulfillmentOverride", labelKey: "actions.fulfillmentOverride" });
      if (PRE_DISPATCH_CANCELLABLE.has(status)) {
        overflow.push({ kind: "cancel", labelKey: "actions.cancel", destructive: true });
      }
    }
    return {
      primary:
        status === "dispatched" && reopenable(input)
          ? { kind: "reopen", labelKey: "actions.reopen" }
          : { kind: "close", labelKey: "actions.close" },
      overflow,
    };
  }

  // ── Group D: Terminal ───────────────────────────────────────────────────
  if (status === "rejected") {
    return {
      primary: reopenable(input)
        ? { kind: "reopen", labelKey: "actions.reopen" }
        : { kind: "close", labelKey: "actions.close" },
      overflow: [],
    };
  }

  // A soft-deleted order can be recovered by a manager/admin. The recover
  // handler (and the RPC) re-check permission + the scanned-deletion guard, so
  // surfacing it here is safe even if the order turns out non-recoverable.
  if (status === "deleted" && isManagerish(role)) {
    return {
      primary: { kind: "recover", labelKey: "actions.recover" },
      overflow: [],
    };
  }

  if (TERMINAL_STATUSES.has(status)) {
    return {
      primary: { kind: "close", labelKey: "actions.close" },
      overflow: [],
    };
  }

  // Unrecognised — close-only fallback so the panel always has a primary CTA.
  return {
    primary: { kind: "close", labelKey: "actions.close" },
    overflow: [],
  };
}

/**
 * Hook wrapper — memoizes on the small set of inputs that actually drive the
 * resolver, so the footer doesn't re-render every SWR mutate.
 */
export function usePrimaryAction(input: PrimaryActionInputs): PanelActions {
  return useMemo(
    () => resolvePanelActions(input),
    [
      input.order.status,
      input.order.assigned_to,
      input.order.updated_at,
      input.order.tracking_number,
      input.order.carrier_barcode_deleted_at,
      input.role,
      input.userId,
      input.hasActiveCarrier,
      input.canReturnToPool,
      input.now,
    ],
  );
}
