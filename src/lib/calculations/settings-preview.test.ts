import { describe, it, expect } from "vitest";
import { previewMaxAttemptsChange } from "./settings-preview";

describe("previewMaxAttemptsChange", () => {
  it("returns noop direction when current === next", () => {
    const result = previewMaxAttemptsChange({
      current: 3,
      next: 3,
      orders: [
        { id: "o1", status: "attempt_2", attempt_count: 2 },
      ],
    });
    expect(result.direction).toBe("noop");
    expect(result.affectedCount).toBe(0);
  });

  it("expand: counts rejected orders whose attempt_count is below the new ceiling", () => {
    const result = previewMaxAttemptsChange({
      current: 3,
      next: 5,
      orders: [
        { id: "o1", status: "rejected", attempt_count: 3 },
        { id: "o2", status: "rejected", attempt_count: 4 },
        { id: "o3", status: "rejected", attempt_count: 5 }, // already at new ceiling
        { id: "o4", status: "confirmed", attempt_count: 2 }, // not rejected
        { id: "o5", status: "rejected", attempt_count: 2 }, // old rejection, unrelated reason
      ],
    });
    expect(result.direction).toBe("expand");
    expect(result.affectedCount).toBe(3); // o1, o2, o5 all rejected with attempt_count < next
  });

  it("shrink: counts active orders whose attempt_count already meets or exceeds the new ceiling", () => {
    const result = previewMaxAttemptsChange({
      current: 3,
      next: 2,
      orders: [
        { id: "o1", status: "attempt_3", attempt_count: 3 },
        { id: "o2", status: "attempt_2", attempt_count: 2 },
        { id: "o3", status: "confirmed", attempt_count: 3 }, // confirmed — not auto-rejected
        { id: "o4", status: "attempt_1", attempt_count: 1 },
      ],
    });
    expect(result.direction).toBe("shrink");
    // pre-dispatch active orders with attempt_count >= 2 would be auto-rejected
    expect(result.affectedCount).toBe(2);
  });

  it("returns zero affected when no matching orders", () => {
    const result = previewMaxAttemptsChange({
      current: 3,
      next: 4,
      orders: [
        { id: "o1", status: "delivered", attempt_count: 0 },
      ],
    });
    expect(result.direction).toBe("expand");
    expect(result.affectedCount).toBe(0);
  });
});
