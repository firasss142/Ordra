import { describe, it, expect } from "vitest";
import {
  ORDER_STATUSES,
  REJECTION_REASONS,
  isTerminalStatus,
  canTransition,
} from "@/types/order-status";

describe("ORDER_STATUSES", () => {
  it("contains exactly 18 statuses (confirmation + dispatch_scheduled + dispatching transient + scanned + fulfillment phases)", () => {
    expect(ORDER_STATUSES).toHaveLength(18);
  });

  it("contains all Phase 1 confirmation statuses", () => {
    expect(ORDER_STATUSES).toEqual(
      expect.arrayContaining([
        "new",
        "assigned",
        "attempt_1",
        "attempt_2",
        "attempt_3",
        "callback_scheduled",
        "confirmed",
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
        "to_be_returned",
        "delivered",
        "returned",
      ])
    );
  });

  it("contains terminal non-fulfillment statuses", () => {
    expect(ORDER_STATUSES).toEqual(
      expect.arrayContaining(["rejected", "cancelled"])
    );
  });
});

describe("isTerminalStatus", () => {
  it("returns true for delivered", () => {
    expect(isTerminalStatus("delivered")).toBe(true);
  });

  it("returns true for returned", () => {
    expect(isTerminalStatus("returned")).toBe(true);
  });

  it("returns true for rejected", () => {
    expect(isTerminalStatus("rejected")).toBe(true);
  });

  it("returns true for cancelled", () => {
    expect(isTerminalStatus("cancelled")).toBe(true);
  });

  it("returns false for dispatched (not terminal — enters fulfillment)", () => {
    expect(isTerminalStatus("dispatched")).toBe(false);
  });

  it("returns false for new", () => {
    expect(isTerminalStatus("new")).toBe(false);
  });

  it("returns false for assigned", () => {
    expect(isTerminalStatus("assigned")).toBe(false);
  });

  it("returns false for attempt_1", () => {
    expect(isTerminalStatus("attempt_1")).toBe(false);
  });

  it("returns false for attempt_2", () => {
    expect(isTerminalStatus("attempt_2")).toBe(false);
  });

  it("returns false for attempt_3", () => {
    expect(isTerminalStatus("attempt_3")).toBe(false);
  });

  it("returns false for callback_scheduled", () => {
    expect(isTerminalStatus("callback_scheduled")).toBe(false);
  });

  it("returns false for confirmed", () => {
    expect(isTerminalStatus("confirmed")).toBe(false);
  });

  it("returns false for dispatching (transient, not terminal)", () => {
    expect(isTerminalStatus("dispatching")).toBe(false);
  });

  it("returns false for scanned (warehouse scanned, not terminal)", () => {
    expect(isTerminalStatus("scanned")).toBe(false);
  });

  it("returns false for deposit", () => {
    expect(isTerminalStatus("deposit")).toBe(false);
  });

  it("returns false for in_transit", () => {
    expect(isTerminalStatus("in_transit")).toBe(false);
  });

  it("returns false for to_be_returned", () => {
    expect(isTerminalStatus("to_be_returned")).toBe(false);
  });
});

describe("canTransition", () => {
  // Phase 1: Confirmation transitions
  it("allows new → assigned", () => {
    expect(canTransition("new", "assigned")).toBe(true);
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

  it("blocks confirmed → dispatching (carrier auto-dispatch removed)", () => {
    expect(canTransition("confirmed", "dispatching")).toBe(false);
  });

  it("allows dispatching → dispatched (carrier succeeded)", () => {
    expect(canTransition("dispatching", "dispatched")).toBe(true);
  });

  it("allows dispatching → confirmed (carrier failed — agent retries)", () => {
    expect(canTransition("dispatching", "confirmed")).toBe(true);
  });

  it("allows confirmed → scanned (warehouse picks up order)", () => {
    expect(canTransition("confirmed", "scanned")).toBe(true);
  });

  it("allows scanned → dispatched (warehouse dispatches after scan)", () => {
    expect(canTransition("scanned", "dispatched")).toBe(true);
  });

  it("allows scanned → cancelled", () => {
    expect(canTransition("scanned", "cancelled")).toBe(true);
  });

  it("blocks confirmed → dispatched (must go through scanned)", () => {
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

  it("allows confirmed → cancelled", () => {
    expect(canTransition("confirmed", "cancelled")).toBe(true);
  });

  it("allows dispatched → cancelled", () => {
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

  it("blocks in_transit → returned (must go through to_be_returned)", () => {
    expect(canTransition("in_transit", "returned")).toBe(false);
  });

  // Terminal statuses block all transitions
  it("blocks delivered → anything", () => {
    expect(canTransition("delivered", "new")).toBe(false);
    expect(canTransition("delivered", "returned")).toBe(false);
  });

  it("blocks returned → anything", () => {
    expect(canTransition("returned", "new")).toBe(false);
    expect(canTransition("returned", "delivered")).toBe(false);
  });

  it("blocks rejected → anything", () => {
    expect(canTransition("rejected", "new")).toBe(false);
    expect(canTransition("rejected", "assigned")).toBe(false);
    expect(canTransition("rejected", "confirmed")).toBe(false);
  });

  it("blocks cancelled → anything", () => {
    expect(canTransition("cancelled", "new")).toBe(false);
    expect(canTransition("cancelled", "assigned")).toBe(false);
    expect(canTransition("cancelled", "confirmed")).toBe(false);
  });

  // Invalid skip transitions
  it("blocks new → dispatched (skipping steps)", () => {
    expect(canTransition("new", "dispatched")).toBe(false);
  });

  it("blocks new → confirmed (skipping steps)", () => {
    expect(canTransition("new", "confirmed")).toBe(false);
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
