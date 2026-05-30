import { describe, it, expect } from "vitest";
import { resolvePanelActions } from "../usePrimaryAction";
import type { PrimaryActionInputs } from "../types";

const NOW = new Date("2026-05-30T12:00:00.000Z");
const RECENT = new Date(NOW.getTime() - 1000 * 60 * 60).toISOString(); // 1h ago — inside agent window
const STALE = new Date(NOW.getTime() - 1000 * 60 * 60 * 24 * 30).toISOString(); // 30d ago — outside agent window

function input(overrides: Partial<PrimaryActionInputs> = {}): PrimaryActionInputs {
  return {
    order: {
      status: "pending",
      assigned_to: "agent-1",
      updated_at: RECENT,
      tracking_number: null,
      carrier_barcode_deleted_at: null,
      ...overrides.order,
    },
    role: "agent",
    userId: "agent-1",
    hasActiveCarrier: true,
    canReturnToPool: true,
    now: NOW,
    ...overrides,
  };
}

describe("resolvePanelActions — primary CTA", () => {
  it("returns endCall for pending", () => {
    const { primary } = resolvePanelActions(input({ order: { status: "pending", assigned_to: "agent-1", updated_at: RECENT, tracking_number: null, carrier_barcode_deleted_at: null } }));
    expect(primary.kind).toBe("endCall");
    expect(primary.labelKey).toBe("actions.endCall");
  });

  it("returns endCall for every attempt_* status", () => {
    for (const status of ["attempt_1", "attempt_2", "attempt_3"]) {
      const { primary } = resolvePanelActions(input({ order: { status, assigned_to: "agent-1", updated_at: RECENT, tracking_number: null, carrier_barcode_deleted_at: null } }));
      expect(primary.kind).toBe("endCall");
    }
  });

  it("returns endCall for callback_scheduled", () => {
    const { primary } = resolvePanelActions(input({ order: { status: "callback_scheduled", assigned_to: "agent-1", updated_at: RECENT, tracking_number: null, carrier_barcode_deleted_at: null } }));
    expect(primary.kind).toBe("endCall");
  });

  it("returns uploadToCarrier for confirmed when an active carrier exists", () => {
    const { primary } = resolvePanelActions(input({ order: { status: "confirmed", assigned_to: "agent-1", updated_at: RECENT, tracking_number: null, carrier_barcode_deleted_at: null } }));
    expect(primary.kind).toBe("uploadToCarrier");
    expect(primary.disabled).toBeFalsy();
  });

  it("disables uploadToCarrier when no active carrier and surfaces primaryDisabledNoCarrier", () => {
    const { primary } = resolvePanelActions(input({
      order: { status: "confirmed", assigned_to: "agent-1", updated_at: RECENT, tracking_number: null, carrier_barcode_deleted_at: null },
      hasActiveCarrier: false,
    }));
    expect(primary.kind).toBe("uploadToCarrier");
    expect(primary.disabled).toBe(true);
    expect(primary.disabledReasonKey).toBe("actions.primaryDisabledNoCarrier");
  });

  it("returns uploadNow for dispatch_scheduled and includes cancelSchedule in overflow", () => {
    const { primary, overflow } = resolvePanelActions(input({ order: { status: "dispatch_scheduled", assigned_to: "agent-1", updated_at: RECENT, tracking_number: null, carrier_barcode_deleted_at: null } }));
    expect(primary.kind).toBe("uploadNow");
    expect(overflow.some((a) => a.kind === "cancelSchedule")).toBe(true);
  });

  it("returns close for terminal statuses with empty overflow", () => {
    for (const status of ["delivered", "returned", "cancelled", "deleted"]) {
      const { primary, overflow } = resolvePanelActions(input({ order: { status, assigned_to: "agent-1", updated_at: RECENT, tracking_number: "TR123", carrier_barcode_deleted_at: null } }));
      expect(primary.kind).toBe("close");
      expect(overflow).toEqual([]);
    }
  });

  it("promotes reopen to primary for rejected within agent window; falls back to close when stale", () => {
    const fresh = resolvePanelActions(input({ order: { status: "rejected", assigned_to: "agent-1", updated_at: RECENT, tracking_number: null, carrier_barcode_deleted_at: null } }));
    expect(fresh.primary.kind).toBe("reopen");
    expect(fresh.overflow.some((a) => a.kind === "reopen")).toBe(false);

    const stale = resolvePanelActions(input({ order: { status: "rejected", assigned_to: "agent-1", updated_at: STALE, tracking_number: null, carrier_barcode_deleted_at: null } }));
    expect(stale.primary.kind).toBe("close");
    expect(stale.overflow.some((a) => a.kind === "reopen")).toBe(false);
  });

  it("agent on uploaded with reference_deleted reverts to confirmed action set", () => {
    const { primary } = resolvePanelActions(input({
      order: {
        status: "uploaded",
        assigned_to: "agent-1",
        updated_at: RECENT,
        tracking_number: null,
        carrier_barcode_deleted_at: RECENT,
      },
    }));
    expect(primary.kind).toBe("uploadToCarrier");
  });

  it("promotes reopen to primary for uploaded within agent window and exposes deleteCarrierBarcode in overflow", () => {
    const { primary, overflow } = resolvePanelActions(input({
      order: { status: "uploaded", assigned_to: "agent-1", updated_at: RECENT, tracking_number: "TR123", carrier_barcode_deleted_at: null },
    }));
    expect(primary.kind).toBe("reopen");
    expect(overflow.some((a) => a.kind === "deleteCarrierBarcode")).toBe(true);
    expect(overflow.some((a) => a.kind === "reopen")).toBe(false);
  });

  it("falls back to close for uploaded when stale; reopen does not appear", () => {
    const { primary, overflow } = resolvePanelActions(input({
      order: { status: "uploaded", assigned_to: "agent-1", updated_at: STALE, tracking_number: "TR123", carrier_barcode_deleted_at: null },
    }));
    expect(primary.kind).toBe("close");
    expect(overflow.some((a) => a.kind === "reopen")).toBe(false);
  });

  it("promotes reopen to primary for dispatched within agent window", () => {
    const { primary } = resolvePanelActions(input({
      order: { status: "dispatched", assigned_to: "agent-1", updated_at: RECENT, tracking_number: "TR123", carrier_barcode_deleted_at: null },
    }));
    expect(primary.kind).toBe("reopen");
  });
});

describe("resolvePanelActions — overflow by role", () => {
  it("manager overflow on confirmed includes cancel and scheduleDispatch", () => {
    const { overflow } = resolvePanelActions(input({
      order: { status: "confirmed", assigned_to: "agent-1", updated_at: RECENT, tracking_number: null, carrier_barcode_deleted_at: null },
      role: "market_manager",
      userId: undefined,
    }));
    expect(overflow.some((a) => a.kind === "cancel")).toBe(true);
    expect(overflow.some((a) => a.kind === "scheduleDispatch")).toBe(true);
  });

  it("super_admin overflow mirrors manager on confirmed", () => {
    const { overflow } = resolvePanelActions(input({
      order: { status: "confirmed", assigned_to: "agent-1", updated_at: RECENT, tracking_number: null, carrier_barcode_deleted_at: null },
      role: "super_admin",
      userId: undefined,
    }));
    expect(overflow.some((a) => a.kind === "cancel")).toBe(true);
    expect(overflow.some((a) => a.kind === "scheduleDispatch")).toBe(true);
  });

  it("agent overflow on confirmed includes scheduleDispatch but excludes cancel", () => {
    const { overflow } = resolvePanelActions(input({
      order: { status: "confirmed", assigned_to: "agent-1", updated_at: RECENT, tracking_number: null, carrier_barcode_deleted_at: null },
    }));
    expect(overflow.some((a) => a.kind === "scheduleDispatch")).toBe(true);
    expect(overflow.some((a) => a.kind === "cancel")).toBe(false);
  });

  it("agent overflow on pending includes returnToPool when canReturnToPool is true", () => {
    const { overflow } = resolvePanelActions(input({ canReturnToPool: true }));
    expect(overflow.some((a) => a.kind === "returnToPool")).toBe(true);
  });

  it("agent overflow on pending omits returnToPool when canReturnToPool is false", () => {
    const { overflow } = resolvePanelActions(input({ canReturnToPool: false }));
    expect(overflow.some((a) => a.kind === "returnToPool")).toBe(false);
  });

  it("manager overflow on uploaded includes cancel; agent overflow does not", () => {
    const managerOverflow = resolvePanelActions(input({
      order: { status: "uploaded", assigned_to: "agent-1", updated_at: RECENT, tracking_number: "TR123", carrier_barcode_deleted_at: null },
      role: "market_manager",
      userId: undefined,
    })).overflow;
    expect(managerOverflow.some((a) => a.kind === "cancel")).toBe(true);

    const agentOverflow = resolvePanelActions(input({
      order: { status: "uploaded", assigned_to: "agent-1", updated_at: RECENT, tracking_number: "TR123", carrier_barcode_deleted_at: null },
    })).overflow;
    expect(agentOverflow.some((a) => a.kind === "cancel")).toBe(false);
  });
});

describe("resolvePanelActions — fulfillment-stage statuses", () => {
  it("returns close for non-reopenable fulfillment statuses (scanned/deposit/in_transit)", () => {
    // `dispatched` is also fulfillment-stage but it's reopenable and therefore
    // tested separately — its primary CTA flips to "reopen" within the window.
    for (const status of ["scanned", "deposit", "in_transit"]) {
      const { primary } = resolvePanelActions(input({
        order: { status, assigned_to: "agent-1", updated_at: RECENT, tracking_number: "TR123", carrier_barcode_deleted_at: null },
      }));
      expect(primary.kind).toBe("close");
    }
  });

  it("manager overflow on scanned includes fulfillmentOverride", () => {
    const { overflow } = resolvePanelActions(input({
      order: { status: "scanned", assigned_to: "agent-1", updated_at: RECENT, tracking_number: "TR123", carrier_barcode_deleted_at: null },
      role: "market_manager",
      userId: undefined,
    }));
    expect(overflow.some((a) => a.kind === "fulfillmentOverride")).toBe(true);
  });

  it("agent overflow on scanned is empty", () => {
    const { overflow } = resolvePanelActions(input({
      order: { status: "scanned", assigned_to: "agent-1", updated_at: RECENT, tracking_number: "TR123", carrier_barcode_deleted_at: null },
    }));
    expect(overflow).toEqual([]);
  });
});

describe("resolvePanelActions — terminal cancel is destructive", () => {
  it("cancel action is flagged destructive", () => {
    const { overflow } = resolvePanelActions(input({
      order: { status: "pending", assigned_to: "agent-1", updated_at: RECENT, tracking_number: null, carrier_barcode_deleted_at: null },
      role: "market_manager",
      userId: undefined,
    }));
    const cancel = overflow.find((a) => a.kind === "cancel");
    expect(cancel?.destructive).toBe(true);
  });
});
