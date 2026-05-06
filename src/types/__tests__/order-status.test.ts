import { describe, it, expect } from "vitest";
import {
  ORDER_STATUSES,
  REJECTION_REASONS,
  isTerminalStatus,
  canTransition,
  isAutoCleared,
} from "@/types/order-status";

describe("ORDER_STATUSES", () => {
  it("contains exactly 20 active statuses", () => {
    expect(ORDER_STATUSES).toHaveLength(20);
  });

  it("contains all Phase 1 confirmation statuses", () => {
    expect(ORDER_STATUSES).toEqual(
      expect.arrayContaining([
        "pending",
        "attempt_1",
        "attempt_2",
        "attempt_3",
        "callback_scheduled",
        "confirmed",
        "uploaded",
      ])
    );
  });

  it("contains all Phase 2 fulfillment statuses", () => {
    expect(ORDER_STATUSES).toEqual(
      expect.arrayContaining([
        "scanned",
        "dispatched",
        "deposit",
        "in_transit",
        "unverified",
        "to_be_returned",
        "received",
        "delivered",
        "returned",
      ])
    );
  });

  it("contains all terminal non-fulfillment statuses", () => {
    expect(ORDER_STATUSES).toEqual(
      expect.arrayContaining(["rejected", "cancelled", "deleted"])
    );
  });

  it("does not contain the removed dispatching status", () => {
    expect(ORDER_STATUSES).not.toContain("dispatching");
  });
});

describe("isTerminalStatus", () => {
  it.each(["delivered", "returned", "rejected", "cancelled", "deleted"] as const)(
    "returns true for terminal status %s",
    (status) => {
      expect(isTerminalStatus(status)).toBe(true);
    }
  );

  it.each([
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
    "dispatched",
    "deposit",
    "in_transit",
    "unverified",
    "to_be_returned",
    "received",
  ] as const)("returns false for non-terminal status %s", (status) => {
    expect(isTerminalStatus(status)).toBe(false);
  });
});

describe("canTransition", () => {
  // Phase 1: Confirmation transitions
  it("allows pending → attempt_1", () => {
    expect(canTransition("pending", "attempt_1")).toBe(true);
  });

  it("allows pending to be confirmed once owned by an actor", () => {
    expect(canTransition("pending", "confirmed")).toBe(true);
  });

  it("allows assigned → attempt_1", () => {
    expect(canTransition("assigned", "attempt_1")).toBe(true);
  });

  it("allows attempt_1 → attempt_2", () => {
    expect(canTransition("attempt_1", "attempt_2")).toBe(true);
  });

  it("allows attempt_2 → attempt_3", () => {
    expect(canTransition("attempt_2", "attempt_3")).toBe(true);
  });

  it("allows assigned → confirmed", () => {
    expect(canTransition("assigned", "confirmed")).toBe(true);
  });

  it("allows confirmed → uploaded (carrier API push)", () => {
    expect(canTransition("confirmed", "uploaded")).toBe(true);
  });

  it("allows confirmed → dispatch_scheduled (defer to a future date)", () => {
    expect(canTransition("confirmed", "dispatch_scheduled")).toBe(true);
  });

  it("allows dispatch_scheduled → uploaded (cron auto-uploads at scheduled time)", () => {
    expect(canTransition("dispatch_scheduled", "uploaded")).toBe(true);
  });

  it("blocks dispatch_scheduled → confirmed (scheduled orders never revert to plain confirmed)", () => {
    expect(canTransition("dispatch_scheduled", "confirmed")).toBe(false);
  });

  it("allows uploaded → scanned (warehouse picks up uploaded order)", () => {
    expect(canTransition("uploaded", "scanned")).toBe(true);
  });

  it("blocks confirmed → scanned (must pass through uploaded)", () => {
    expect(canTransition("confirmed", "scanned")).toBe(false);
  });

  it("allows scanned → dispatched (warehouse dispatches after scan)", () => {
    expect(canTransition("scanned", "dispatched")).toBe(true);
  });

  it("allows scanned → deleted (manual removal)", () => {
    expect(canTransition("scanned", "deleted")).toBe(true);
  });

  it("blocks confirmed → dispatched (must go through uploaded → scanned)", () => {
    expect(canTransition("confirmed", "dispatched")).toBe(false);
  });

  it("allows assigned → callback_scheduled", () => {
    expect(canTransition("assigned", "callback_scheduled")).toBe(true);
  });

  it("allows attempt_1 → callback_scheduled", () => {
    expect(canTransition("attempt_1", "callback_scheduled")).toBe(true);
  });

  it("allows callback_scheduled → confirmed", () => {
    expect(canTransition("callback_scheduled", "confirmed")).toBe(true);
  });

  it("allows assigned → rejected", () => {
    expect(canTransition("assigned", "rejected")).toBe(true);
  });

  it("allows confirmed → deleted (manual removal)", () => {
    expect(canTransition("confirmed", "deleted")).toBe(true);
  });

  it("allows uploaded → deleted (manual removal)", () => {
    expect(canTransition("uploaded", "deleted")).toBe(true);
  });

  it("allows dispatched → deleted (manual removal)", () => {
    expect(canTransition("dispatched", "deleted")).toBe(true);
  });

  it("allows dispatched → cancelled (carrier-cancelled)", () => {
    expect(canTransition("dispatched", "cancelled")).toBe(true);
  });

  // Phase 2: Fulfillment transitions
  it("allows dispatched → deposit", () => {
    expect(canTransition("dispatched", "deposit")).toBe(true);
  });

  it("allows deposit → in_transit", () => {
    expect(canTransition("deposit", "in_transit")).toBe(true);
  });

  it("allows in_transit → delivered", () => {
    expect(canTransition("in_transit", "delivered")).toBe(true);
  });

  it("allows in_transit → to_be_returned", () => {
    expect(canTransition("in_transit", "to_be_returned")).toBe(true);
  });

  it("allows to_be_returned → returned", () => {
    expect(canTransition("to_be_returned", "returned")).toBe(true);
  });

  it("allows to_be_returned → received (warehouse scan-back)", () => {
    expect(canTransition("to_be_returned", "received")).toBe(true);
  });

  it("blocks in_transit → returned (must go through to_be_returned)", () => {
    expect(canTransition("in_transit", "returned")).toBe(false);
  });

  // Carrier event statuses
  it("allows dispatched → unverified (carrier flagged a problem)", () => {
    expect(canTransition("dispatched", "unverified")).toBe(true);
  });

  it("allows in_transit → unverified", () => {
    expect(canTransition("in_transit", "unverified")).toBe(true);
  });

  it("allows unverified → in_transit (auto-clears on next carrier event)", () => {
    expect(canTransition("unverified", "in_transit")).toBe(true);
  });

  it("allows unverified → delivered", () => {
    expect(canTransition("unverified", "delivered")).toBe(true);
  });

  it("allows unverified → cancelled (carrier-cancelled after problem)", () => {
    expect(canTransition("unverified", "cancelled")).toBe(true);
  });

  // Terminal statuses block all transitions
  it("blocks delivered → anything", () => {
    expect(canTransition("delivered", "pending")).toBe(false);
    expect(canTransition("delivered", "returned")).toBe(false);
  });

  it("blocks returned → anything", () => {
    expect(canTransition("returned", "pending")).toBe(false);
    expect(canTransition("returned", "delivered")).toBe(false);
  });

  it("blocks rejected → anything", () => {
    expect(canTransition("rejected", "pending")).toBe(false);
    expect(canTransition("rejected", "assigned")).toBe(false);
    expect(canTransition("rejected", "confirmed")).toBe(false);
  });

  it("blocks cancelled → anything (carrier-cancelled is terminal)", () => {
    expect(canTransition("cancelled", "pending")).toBe(false);
    expect(canTransition("cancelled", "assigned")).toBe(false);
    expect(canTransition("cancelled", "confirmed")).toBe(false);
  });

  it("blocks deleted → anything (manually deleted is terminal)", () => {
    expect(canTransition("deleted", "pending")).toBe(false);
    expect(canTransition("deleted", "assigned")).toBe(false);
  });

  // Invalid skip transitions
  it("blocks pending → dispatched (skipping steps)", () => {
    expect(canTransition("pending", "dispatched")).toBe(false);
  });

  it("blocks pending → assigned because assignment is not a lifecycle status", () => {
    expect(canTransition("pending", "assigned")).toBe(false);
  });

  it("blocks attempt_1 → attempt_3 (skipping attempt_2)", () => {
    expect(canTransition("attempt_1", "attempt_3")).toBe(false);
  });

  it("blocks dispatched → delivered (must go through deposit + in_transit)", () => {
    expect(canTransition("dispatched", "delivered")).toBe(false);
  });

  it("blocks deposit → delivered (must go through in_transit)", () => {
    expect(canTransition("deposit", "delivered")).toBe(false);
  });
});

describe("isAutoCleared", () => {
  it("returns true only for unverified", () => {
    expect(isAutoCleared("unverified")).toBe(true);
  });

  it.each([
    "pending",
    "assigned",
    "confirmed",
    "uploaded",
    "dispatched",
    "deposit",
    "in_transit",
    "delivered",
    "received",
  ] as const)("returns false for %s", (status) => {
    expect(isAutoCleared(status)).toBe(false);
  });
});

describe("REJECTION_REASONS", () => {
  it("contains exactly 7 rejection reasons", () => {
    expect(REJECTION_REASONS).toHaveLength(7);
  });

  it("contains all required rejection reason values", () => {
    expect(REJECTION_REASONS).toEqual(
      expect.arrayContaining([
        "refus_client",
        "faux_numero",
        "doublon",
        "injoignable",
        "prix",
        "non_serieux",
        "autre",
      ])
    );
  });
});
