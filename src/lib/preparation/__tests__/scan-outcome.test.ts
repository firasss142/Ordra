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

/**
 * The two site refusals.
 *
 * `WRONG_SITE` has been raised by three SQL functions since 20260922000013 and
 * was never listed here, so it fell through to the generic error: the agent read
 * "something went wrong" while the RPC had already computed the name of the
 * building the parcel actually belongs to and thrown it away. `NO_SITE_ASSIGNED`
 * is its companion, for an agent nobody has assigned to a building at all.
 */
describe("errorLabelKey — the building", () => {
  it("a parcel from the other building has its own words", () => {
    expect(errorLabelKey("WRONG_SITE")).toBe("errWrongSite");
  });

  it("an unassigned agent is told to see their manager, not that it broke", () => {
    expect(errorLabelKey("NO_SITE_ASSIGNED")).toBe("errNoSite");
  });
});
