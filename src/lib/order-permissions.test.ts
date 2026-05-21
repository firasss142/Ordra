import { describe, test, expect } from "vitest";
import {
  canViewOrders,
  canCreateOrders,
  canAssignOrders,
  canCancelOrder,
  canDeleteDuplicateSibling,
  canTransitionOrder,
  canUpdateFulfillment,
  canReopenOrder,
  canEditOrder,
  canManuallyDeleteOrderStatus,
  isReferenceDeletedUpload,
  isBulkCallEligible,
} from "./order-permissions";

const MARKET_A = "market-a";
const MARKET_B = "market-b";

describe("canViewOrders", () => {
  test("super_admin can view orders in any market", () => {
    expect(canViewOrders("super_admin", MARKET_A, "")).toBe(true);
    expect(canViewOrders("super_admin", MARKET_B, "")).toBe(true);
  });

  test("market_manager can view orders in own market", () => {
    expect(canViewOrders("market_manager", MARKET_A, MARKET_A)).toBe(true);
  });

  test("market_manager cannot view orders in other market", () => {
    expect(canViewOrders("market_manager", MARKET_B, MARKET_A)).toBe(false);
  });

  test("agent can view orders (RLS filters by assigned_to)", () => {
    expect(canViewOrders("agent", MARKET_A, MARKET_A)).toBe(true);
  });

  test("warehouse_agent can view orders in own market", () => {
    expect(canViewOrders("warehouse_agent", MARKET_A, MARKET_A)).toBe(true);
  });

  test("warehouse_agent cannot view orders in other market", () => {
    expect(canViewOrders("warehouse_agent", MARKET_B, MARKET_A)).toBe(false);
  });
});

describe("canCreateOrders", () => {
  test("super_admin can create orders in any market", () => {
    expect(canCreateOrders("super_admin", MARKET_A, "")).toBe(true);
  });

  test("market_manager can create orders in own market", () => {
    expect(canCreateOrders("market_manager", MARKET_A, MARKET_A)).toBe(true);
  });

  test("market_manager cannot create orders in other market", () => {
    expect(canCreateOrders("market_manager", MARKET_B, MARKET_A)).toBe(false);
  });

  test("agent can create orders in own market", () => {
    expect(canCreateOrders("agent", MARKET_A, MARKET_A)).toBe(true);
  });

  test("agent cannot create orders in another market", () => {
    expect(canCreateOrders("agent", MARKET_B, MARKET_A)).toBe(false);
  });
});

describe("canAssignOrders", () => {
  test("super_admin can assign orders in any market", () => {
    expect(canAssignOrders("super_admin", MARKET_A, "")).toBe(true);
  });

  test("market_manager can assign orders in own market", () => {
    expect(canAssignOrders("market_manager", MARKET_A, MARKET_A)).toBe(true);
  });

  test("market_manager cannot assign orders in other market", () => {
    expect(canAssignOrders("market_manager", MARKET_B, MARKET_A)).toBe(false);
  });

  test("agent cannot assign orders", () => {
    expect(canAssignOrders("agent", MARKET_A, MARKET_A)).toBe(false);
  });
});

describe("canCancelOrder", () => {
  test("super_admin can cancel orders", () => {
    expect(canCancelOrder("super_admin")).toBe(true);
  });

  test("market_manager can cancel orders", () => {
    expect(canCancelOrder("market_manager")).toBe(true);
  });

  test("agent cannot cancel orders", () => {
    expect(canCancelOrder("agent")).toBe(false);
  });
});

describe("canDeleteDuplicateSibling", () => {
  test("super_admin can delete a verified sibling in any market", () => {
    expect(canDeleteDuplicateSibling("super_admin", MARKET_A, "")).toBe(true);
    expect(canDeleteDuplicateSibling("super_admin", MARKET_B, MARKET_A)).toBe(true);
  });

  test("market_manager can delete a verified sibling in own market only", () => {
    expect(canDeleteDuplicateSibling("market_manager", MARKET_A, MARKET_A)).toBe(true);
    expect(canDeleteDuplicateSibling("market_manager", MARKET_B, MARKET_A)).toBe(false);
  });

  test("agent CAN delete a verified sibling in own market (scoped power)", () => {
    expect(canDeleteDuplicateSibling("agent", MARKET_A, MARKET_A)).toBe(true);
  });

  test("agent cannot delete a sibling in another market", () => {
    expect(canDeleteDuplicateSibling("agent", MARKET_B, MARKET_A)).toBe(false);
  });

  test("warehouse_agent cannot delete duplicate siblings", () => {
    expect(canDeleteDuplicateSibling("warehouse_agent", MARKET_A, MARKET_A)).toBe(false);
  });
});

describe("canManuallyDeleteOrderStatus", () => {
  test("allows only the manual Annuler status set", () => {
    expect(canManuallyDeleteOrderStatus("pending")).toBe(true);
    expect(canManuallyDeleteOrderStatus("confirmed")).toBe(true);
    expect(canManuallyDeleteOrderStatus("uploaded")).toBe(true);
    expect(canManuallyDeleteOrderStatus("scanned")).toBe(true);
    expect(canManuallyDeleteOrderStatus("dispatched")).toBe(false);
    expect(canManuallyDeleteOrderStatus("delivered")).toBe(false);
    expect(canManuallyDeleteOrderStatus("deleted")).toBe(false);
  });
});

describe("canTransitionOrder", () => {
  // Agent can set: attempt_*, callback_scheduled, confirmed, rejected
  test("agent can transition assigned to attempt_1", () => {
    expect(canTransitionOrder("agent", "assigned", "attempt_1")).toBe(true);
  });

  test("agent can transition attempt_1 to callback_scheduled", () => {
    expect(canTransitionOrder("agent", "attempt_1", "callback_scheduled")).toBe(true);
  });

  test("agent can transition attempt_3 to confirmed", () => {
    expect(canTransitionOrder("agent", "attempt_3", "confirmed")).toBe(true);
  });

  test("agent can transition assigned to rejected", () => {
    expect(canTransitionOrder("agent", "assigned", "rejected")).toBe(true);
  });

  // Agent CAN set uploaded (the upload-to-carrier action is most often agent-driven)
  test("agent can transition confirmed to uploaded", () => {
    expect(canTransitionOrder("agent", "confirmed", "uploaded")).toBe(true);
  });

  // Agent CANNOT set: scanned, dispatched, deposit, in_transit, delivered, returned, cancelled
  test("agent cannot transition uploaded to scanned directly (warehouse-only)", () => {
    expect(canTransitionOrder("agent", "uploaded", "scanned")).toBe(false);
  });

  test("agent cannot transition confirmed to dispatched directly (must go through uploaded → scanned)", () => {
    expect(canTransitionOrder("agent", "confirmed", "dispatched")).toBe(false);
  });

  test("agent cannot cancel orders", () => {
    expect(canTransitionOrder("agent", "assigned", "deleted")).toBe(false);
  });

  test("agent cannot set fulfillment statuses", () => {
    expect(canTransitionOrder("agent", "dispatched", "deposit")).toBe(false);
    expect(canTransitionOrder("agent", "deposit", "in_transit")).toBe(false);
    expect(canTransitionOrder("agent", "in_transit", "delivered")).toBe(false);
    expect(canTransitionOrder("agent", "in_transit", "to_be_returned")).toBe(false);
  });

  // Market manager: all Phase 1 + deleted + warehouse scan flow
  test("market_manager can transition confirmed to uploaded", () => {
    expect(canTransitionOrder("market_manager", "confirmed", "uploaded")).toBe(true);
  });

  test("market_manager can transition uploaded to scanned (warehouse scan-out)", () => {
    expect(canTransitionOrder("market_manager", "uploaded", "scanned")).toBe(true);
  });

  test("market_manager can transition scanned to dispatched", () => {
    expect(canTransitionOrder("market_manager", "scanned", "dispatched")).toBe(true);
  });

  test("market_manager cannot transition confirmed to scanned (must pass through uploaded)", () => {
    expect(canTransitionOrder("market_manager", "confirmed", "scanned")).toBe(false);
  });

  test("market_manager can cancel pre-dispatch orders", () => {
    expect(canTransitionOrder("market_manager", "assigned", "deleted")).toBe(true);
    expect(canTransitionOrder("market_manager", "confirmed", "deleted")).toBe(true);
  });

  test("market_manager can set fulfillment statuses", () => {
    expect(canTransitionOrder("market_manager", "dispatched", "deposit")).toBe(true);
    expect(canTransitionOrder("market_manager", "deposit", "in_transit")).toBe(true);
    expect(canTransitionOrder("market_manager", "in_transit", "delivered")).toBe(true);
    expect(canTransitionOrder("market_manager", "in_transit", "to_be_returned")).toBe(true);
    expect(canTransitionOrder("market_manager", "to_be_returned", "returned")).toBe(true);
  });

  // Super admin: all transitions
  test("super_admin can do all transitions", () => {
    expect(canTransitionOrder("super_admin", "pending", "attempt_1")).toBe(true);
    expect(canTransitionOrder("super_admin", "confirmed", "uploaded")).toBe(true);
    expect(canTransitionOrder("super_admin", "uploaded", "scanned")).toBe(true);
    expect(canTransitionOrder("super_admin", "scanned", "dispatched")).toBe(true);
    expect(canTransitionOrder("super_admin", "in_transit", "delivered")).toBe(true);
  });

  // Invalid graph transitions return false regardless of role
  test("returns false for invalid graph transitions even for super_admin", () => {
    expect(canTransitionOrder("super_admin", "pending", "dispatched")).toBe(false);
    expect(canTransitionOrder("super_admin", "delivered", "pending")).toBe(false);
  });
});

describe("canUpdateFulfillment", () => {
  test("super_admin can update fulfillment", () => {
    expect(canUpdateFulfillment("super_admin")).toBe(true);
  });

  test("market_manager can update fulfillment", () => {
    expect(canUpdateFulfillment("market_manager")).toBe(true);
  });

  test("agent cannot update fulfillment", () => {
    expect(canUpdateFulfillment("agent")).toBe(false);
  });
});

describe("canReopenOrder", () => {
  const AGENT_ID = "agent-1";
  const now = new Date("2026-04-18T12:00:00Z");
  const withinWindow = new Date("2026-04-15T12:00:00Z").toISOString(); // 3 days ago
  const outsideWindow = new Date("2026-04-09T12:00:00Z").toISOString(); // 9 days ago

  test("agent can reopen own rejected order within 7-day window", () => {
    expect(canReopenOrder("agent", AGENT_ID, {
      status: "rejected", assigned_to: AGENT_ID, updated_at: withinWindow,
    }, now)).toBe(true);
  });

  test("agent can reopen own uploaded order within 7-day window", () => {
    expect(canReopenOrder("agent", AGENT_ID, {
      status: "uploaded", assigned_to: AGENT_ID, updated_at: withinWindow,
    }, now)).toBe(true);
  });

  test("agent cannot reopen plain confirmed order (no carrier work to undo)", () => {
    expect(canReopenOrder("agent", AGENT_ID, {
      status: "confirmed", assigned_to: AGENT_ID, updated_at: withinWindow,
    }, now)).toBe(false);
  });

  test("agent can reopen own dispatched order within 7-day window", () => {
    expect(canReopenOrder("agent", AGENT_ID, {
      status: "dispatched", assigned_to: AGENT_ID, updated_at: withinWindow,
    }, now)).toBe(true);
  });

  test("agent cannot reopen order assigned to another agent", () => {
    expect(canReopenOrder("agent", AGENT_ID, {
      status: "rejected", assigned_to: "agent-2", updated_at: withinWindow,
    }, now)).toBe(false);
  });

  test("agent cannot reopen rejected order outside 7-day window", () => {
    expect(canReopenOrder("agent", AGENT_ID, {
      status: "rejected", assigned_to: AGENT_ID, updated_at: outsideWindow,
    }, now)).toBe(false);
  });

  test("agent cannot reopen dispatched order outside 7-day window", () => {
    expect(canReopenOrder("agent", AGENT_ID, {
      status: "dispatched", assigned_to: AGENT_ID, updated_at: outsideWindow,
    }, now)).toBe(false);
  });

  test("agent cannot reopen an assigned order (not a closed status)", () => {
    expect(canReopenOrder("agent", AGENT_ID, {
      status: "assigned", assigned_to: AGENT_ID, updated_at: withinWindow,
    }, now)).toBe(false);
  });

  test("agent cannot reopen a delivered order (true terminal)", () => {
    expect(canReopenOrder("agent", AGENT_ID, {
      status: "delivered", assigned_to: AGENT_ID, updated_at: withinWindow,
    }, now)).toBe(false);
  });

  test("market_manager cannot reopen orders (agent-only action)", () => {
    expect(canReopenOrder("market_manager", AGENT_ID, {
      status: "rejected", assigned_to: AGENT_ID, updated_at: withinWindow,
    }, now)).toBe(false);
  });

  test("uses current time when now param is omitted", () => {
    // rejected 1 day ago — should pass
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(canReopenOrder("agent", AGENT_ID, {
      status: "rejected", assigned_to: AGENT_ID, updated_at: yesterday,
    })).toBe(true);
  });
});

describe("isReferenceDeletedUpload", () => {
  test("true for uploaded order whose barcode was deleted and has no tracking number", () => {
    expect(
      isReferenceDeletedUpload({
        status: "uploaded",
        tracking_number: null,
        carrier_barcode_deleted_at: "2026-05-20T10:00:00Z",
      }),
    ).toBe(true);
  });

  test("false for uploaded order that still has a tracking number", () => {
    expect(
      isReferenceDeletedUpload({
        status: "uploaded",
        tracking_number: "TRK-123",
        carrier_barcode_deleted_at: "2026-05-20T10:00:00Z",
      }),
    ).toBe(false);
  });

  test("false for uploaded order whose barcode was never deleted", () => {
    expect(
      isReferenceDeletedUpload({
        status: "uploaded",
        tracking_number: "TRK-123",
        carrier_barcode_deleted_at: null,
      }),
    ).toBe(false);
  });

  test("false for a confirmed order (not an upload)", () => {
    expect(
      isReferenceDeletedUpload({
        status: "confirmed",
        tracking_number: null,
        carrier_barcode_deleted_at: null,
      }),
    ).toBe(false);
  });

  test("tolerates missing optional fields", () => {
    expect(isReferenceDeletedUpload({ status: "uploaded" })).toBe(false);
  });
});

describe("isBulkCallEligible", () => {
  test.each(["pending", "assigned", "attempt_1", "attempt_2", "attempt_3", "callback_scheduled"])(
    "eligible for call-pool status %s",
    (status) => {
      expect(isBulkCallEligible({ status })).toBe(true);
    },
  );

  test.each(["confirmed", "dispatch_scheduled", "dispatched", "scanned", "delivered", "returned", "rejected", "cancelled"])(
    "not eligible for status %s",
    (status) => {
      expect(isBulkCallEligible({ status })).toBe(false);
    },
  );

  test("not eligible for a normal uploaded order", () => {
    expect(
      isBulkCallEligible({ status: "uploaded", tracking_number: "TRK-1", carrier_barcode_deleted_at: null }),
    ).toBe(false);
  });

  test("eligible for a reference-deleted upload", () => {
    expect(
      isBulkCallEligible({ status: "uploaded", tracking_number: null, carrier_barcode_deleted_at: "2026-05-20T10:00:00Z" }),
    ).toBe(true);
  });
});

describe("canEditOrder", () => {
  const AGENT_ID = "agent-1";
  const now = new Date("2026-05-21T12:00:00Z");
  const recent = new Date("2026-05-20T12:00:00Z").toISOString();

  test("agent cannot edit a normal uploaded order (locked)", () => {
    expect(
      canEditOrder("agent", AGENT_ID, {
        status: "uploaded",
        assigned_to: AGENT_ID,
        updated_at: recent,
        tracking_number: "TRK-1",
        carrier_barcode_deleted_at: null,
      }, now),
    ).toBe(false);
  });

  test("agent CAN edit own uploaded order once the reference is deleted", () => {
    expect(
      canEditOrder("agent", AGENT_ID, {
        status: "uploaded",
        assigned_to: AGENT_ID,
        updated_at: recent,
        tracking_number: null,
        carrier_barcode_deleted_at: recent,
      }, now),
    ).toBe(true);
  });

  test("agent cannot edit a reference-deleted upload assigned to someone else", () => {
    expect(
      canEditOrder("agent", AGENT_ID, {
        status: "uploaded",
        assigned_to: "agent-2",
        updated_at: recent,
        tracking_number: null,
        carrier_barcode_deleted_at: recent,
      }, now),
    ).toBe(false);
  });

  test("agent can edit own pending order", () => {
    expect(
      canEditOrder("agent", AGENT_ID, {
        status: "pending",
        assigned_to: AGENT_ID,
        updated_at: recent,
      }, now),
    ).toBe(true);
  });

  test("manager can edit any uploaded order regardless of reference state", () => {
    expect(
      canEditOrder("market_manager", AGENT_ID, {
        status: "uploaded",
        assigned_to: AGENT_ID,
        updated_at: recent,
        tracking_number: "TRK-1",
        carrier_barcode_deleted_at: null,
      }, now),
    ).toBe(true);
  });
});
