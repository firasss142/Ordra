import { describe, it, expect } from "vitest";
import { readActionFailure } from "./action-failure";

describe("readActionFailure", () => {
  it("reports a lost race so the caller knows to refresh", () => {
    const f = readActionFailure(400, { error: "invalid transition from confirmed to attempt_1", code: "conflict", status: "confirmed" });
    expect(f.conflict).toBe(true);
    expect(f.freshStatus).toBe("confirmed");
  });

  it("treats a 409 with a conflict code as a lost race whatever its body", () => {
    const f = readActionFailure(409, { error: "Modifiée entre-temps", code: "conflict" });
    expect(f.conflict).toBe(true);
    expect(f.freshStatus).toBeNull();
  });

  // The cancel and recover routes answer 409 for their own reasons ("not
  // recoverable", "already dispatched"): the order moved under the user either
  // way, so the list is stale and must be refreshed — but the route's own
  // sentence is the useful one, not a generic conflict line.
  it("treats any 409 as stale state while keeping the server's wording", () => {
    const f = readActionFailure(409, { error: "Cette commande ne peut plus être restaurée.", reason: "not_recoverable" });
    expect(f.conflict).toBe(true);
    expect(f.message).toBe("Cette commande ne peut plus être restaurée.");
  });

  it("passes an ordinary failure through untouched", () => {
    const f = readActionFailure(500, { error: "Internal server error" });
    expect(f.conflict).toBe(false);
    expect(f.message).toBe("Internal server error");
  });

  it("survives a body that is not the shape we expect", () => {
    expect(readActionFailure(500, null).message).toBeNull();
    expect(readActionFailure(500, "boom").conflict).toBe(false);
    expect(readActionFailure(403, { error: 42 }).message).toBeNull();
  });
});
