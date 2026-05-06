import { describe, it, expect } from "vitest";
import {
  validateTransition,
  buildOrderHistoryEntry,
  buildAssignmentHistoryEntry,
} from "@/lib/order-engine";

describe("validateTransition", () => {
  // Valid Phase 1 transitions
  it("allows pending → attempt_1", () => {
    expect(validateTransition("pending", "attempt_1")).toEqual({ valid: true });
  });

  it("allows pending to be confirmed once owned by an actor", () => {
    expect(validateTransition("pending", "confirmed")).toEqual({ valid: true });
  });

  it("allows assigned → attempt_1", () => {
    expect(validateTransition("assigned", "attempt_1")).toEqual({ valid: true });
  });

  it("allows assigned → confirmed", () => {
    expect(validateTransition("assigned", "confirmed")).toEqual({ valid: true });
  });

  it("blocks confirmed → dispatching (carrier auto-dispatch removed)", () => {
    expect(validateTransition("confirmed", "dispatching")).toMatchObject({ valid: false });
  });

  it("allows dispatching → dispatched (carrier succeeded)", () => {
    expect(validateTransition("dispatching", "dispatched")).toEqual({ valid: true });
  });

  it("allows dispatching → confirmed (carrier failed — rollback)", () => {
    expect(validateTransition("dispatching", "confirmed")).toEqual({ valid: true });
  });

  it("blocks confirmed → dispatched (must go through scanned first)", () => {
    expect(validateTransition("confirmed", "dispatched")).toMatchObject({ valid: false });
  });

  // Valid Phase 2 transitions
  it("allows dispatched → deposit", () => {
    expect(validateTransition("dispatched", "deposit")).toEqual({ valid: true });
  });

  it("allows deposit → in_transit", () => {
    expect(validateTransition("deposit", "in_transit")).toEqual({ valid: true });
  });

  it("allows in_transit → delivered", () => {
    expect(validateTransition("in_transit", "delivered")).toEqual({ valid: true });
  });

  it("allows in_transit → to_be_returned", () => {
    expect(validateTransition("in_transit", "to_be_returned")).toEqual({ valid: true });
  });

  it("allows to_be_returned → returned", () => {
    expect(validateTransition("to_be_returned", "returned")).toEqual({ valid: true });
  });

  it("blocks in_transit → returned (must go through to_be_returned)", () => {
    const result = validateTransition("in_transit", "returned");
    expect(result.valid).toBe(false);
  });

  // Terminal statuses block all transitions
  it("blocks delivered → anything (terminal)", () => {
    const result = validateTransition("delivered", "pending");
    expect(result.valid).toBe(false);
    expect(result).toHaveProperty("reason");
    expect(typeof (result as { valid: false; reason: string }).reason).toBe("string");
  });

  it("blocks returned → anything (terminal)", () => {
    const result = validateTransition("returned", "in_transit");
    expect(result.valid).toBe(false);
    expect(result).toHaveProperty("reason");
  });

  it("blocks rejected → anything (terminal)", () => {
    const result = validateTransition("rejected", "assigned");
    expect(result.valid).toBe(false);
    expect(result).toHaveProperty("reason");
  });

  it("blocks deleted → anything (terminal)", () => {
    const result = validateTransition("deleted", "pending");
    expect(result.valid).toBe(false);
    expect(result).toHaveProperty("reason");
  });

  // Invalid skip transitions
  it("blocks pending → dispatched (skips confirmation)", () => {
    const result = validateTransition("pending", "dispatched");
    expect(result.valid).toBe(false);
    expect(result).toHaveProperty("reason");
  });

  it("blocks dispatched → delivered (must go through deposit + in_transit)", () => {
    const result = validateTransition("dispatched", "delivered");
    expect(result.valid).toBe(false);
    expect(result).toHaveProperty("reason");
  });
});

describe("buildOrderHistoryEntry", () => {
  it("returns an entry with all required fields", () => {
    const entry = buildOrderHistoryEntry("order-1", "pending", "assigned", "actor-1");

    expect(entry.order_id).toBe("order-1");
    expect(entry.status_from).toBe("pending");
    expect(entry.status_to).toBe("assigned");
    expect(entry.actor_id).toBe("actor-1");
    expect(typeof entry.created_at).toBe("string");
  });

  it("created_at is an ISO string", () => {
    const entry = buildOrderHistoryEntry("order-2", "assigned", "attempt_1", "actor-2");
    const parsed = new Date(entry.created_at);
    expect(parsed.toISOString()).toBe(entry.created_at);
  });

  it("note defaults to null when not provided", () => {
    const entry = buildOrderHistoryEntry("order-3", "attempt_1", "confirmed", "actor-3");
    expect(entry.note).toBeNull();
  });

  it("note is included when provided", () => {
    const entry = buildOrderHistoryEntry(
      "order-4",
      "confirmed",
      "dispatched",
      "actor-4",
      "Dispatched to carrier"
    );
    expect(entry.note).toBe("Dispatched to carrier");
  });

  it("throws when statusFrom is not a valid ORDER_STATUS", () => {
    expect(() =>
      buildOrderHistoryEntry("order-5", "invalid_status" as never, "assigned", "actor-5")
    ).toThrow();
  });

  it("throws when statusTo is not a valid ORDER_STATUS", () => {
    expect(() =>
      buildOrderHistoryEntry("order-6", "pending", "not_a_status" as never, "actor-6")
    ).toThrow();
  });

  it("actor_id can be null (for system actions)", () => {
    const entry = buildOrderHistoryEntry("order-7", "pending", "assigned", null);
    expect(entry.actor_id).toBeNull();
  });
});

describe("buildAssignmentHistoryEntry", () => {
  it("returns entry for 'assigned' action with correct note", () => {
    const entry = buildAssignmentHistoryEntry("order-1", "agent-abc", "manager-1", "assigned");

    expect(entry.order_id).toBe("order-1");
    expect(entry.actor_id).toBe("manager-1");
    expect(typeof entry.note).toBe("string");
    expect(entry.note).toContain("agent-abc");
  });

  it("note for 'assigned' action mentions the agent", () => {
    const entry = buildAssignmentHistoryEntry("order-1", "agent-abc", "manager-1", "assigned");
    expect(entry.note).toMatch(/assigned/i);
    expect(entry.note).toContain("agent-abc");
  });

  it("returns entry for 'reassigned' action with correct note", () => {
    const entry = buildAssignmentHistoryEntry("order-2", "agent-xyz", "manager-1", "reassigned");
    expect(entry.note).toMatch(/reassigned/i);
  });

  it("returns entry for 'unassigned' action with correct note", () => {
    const entry = buildAssignmentHistoryEntry("order-3", "agent-abc", "manager-1", "unassigned");
    expect(entry.note).toMatch(/unassigned/i);
  });

  it("status_from and status_to are the same because assignment does not change lifecycle status", () => {
    const entry = buildAssignmentHistoryEntry("order-4", "agent-1", "manager-1", "reassigned");
    expect(entry.status_from).toBe(entry.status_to);
  });

  it("returns entry with order_id, status_from, status_to, actor_id, note, created_at", () => {
    const entry = buildAssignmentHistoryEntry("order-5", "agent-2", "manager-2", "assigned");

    expect(entry).toHaveProperty("order_id");
    expect(entry).toHaveProperty("status_from");
    expect(entry).toHaveProperty("status_to");
    expect(entry).toHaveProperty("actor_id");
    expect(entry).toHaveProperty("note");
    expect(entry).toHaveProperty("created_at");
  });
});
