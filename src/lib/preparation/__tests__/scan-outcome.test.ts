import { describe, it, expect } from "vitest";
import { outcomeFor, errorLabelKey } from "../scan-outcome";

describe("scan outcome", () => {
  it("only a 2xx is a clean bind", () => {
    expect(outcomeFor(true, {})).toBe("bound");
    expect(outcomeFor(false, { darb_bound: true, error_code: "STOCK_UNDERFLOW" })).toBe("bound_not_committed");
    expect(outcomeFor(false, { error_code: "DARB_BIND_FAILED" })).toBe("refused_darb");
    expect(outcomeFor(false, { error_code: "DARB_SHIPMENT_UNKNOWN" })).toBe("refused_darb");
    expect(outcomeFor(false, { error_code: "STICKER_ALREADY_USED" })).toBe("refused_here");
  });

  it("words every refusal the API can return, and nothing else", () => {
    for (const code of ["STICKER_ALREADY_USED", "GONE_AT_CARRIER", "STICKER_NOT_NUMERIC", "FORBIDDEN", "STOCK_UNDERFLOW"]) {
      expect(errorLabelKey(code)).toMatch(/^err/);
    }
    expect(errorLabelKey("SOMETHING_NEW")).toBeNull();
    expect(errorLabelKey(undefined)).toBeNull();
  });
});
