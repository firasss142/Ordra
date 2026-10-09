import { describe, expect, it } from "vitest";
import { formatPhone, sameProductToCall, tallyOf } from "./repeat-customers";

const o = (status: string, product_id: string | null = "p1", product_name: string | null = "Biolisse") => ({ status, product_id, product_name });

describe("tallyOf", () => {
  it("counts delivered, lost (rejected + returned) and still live, ignoring cancelled", () => {
    expect(tallyOf([o("delivered"), o("rejected"), o("returned"), o("pending"), o("in_transit"), o("cancelled")])).toEqual({
      delivered: 1,
      lost: 2,
      live: 2,
    });
  });

  it("is all zeros for no orders", () => {
    expect(tallyOf([])).toEqual({ delivered: 0, lost: 0, live: 0 });
  });
});

describe("sameProductToCall", () => {
  it("returns the orders still to call that share a product with another one still to call", () => {
    const a = { ...o("pending"), id: "a" };
    const b = { ...o("attempt_1"), id: "b" };
    const c = { ...o("pending", "p2", "Other"), id: "c" };
    expect(sameProductToCall([a, b, c]).map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("ignores parcels already confirmed or on the road — nobody calls those again", () => {
    expect(sameProductToCall([{ ...o("in_transit"), id: "a" }, { ...o("confirmed"), id: "b" }, { ...o("callback_scheduled"), id: "c" }])).toEqual([]);
  });

  it("ignores finished orders — a re-buy after a delivery is not a double call", () => {
    expect(sameProductToCall([{ ...o("delivered"), id: "a" }, { ...o("pending"), id: "b" }])).toEqual([]);
  });

  it("falls back to the product name when there is no product id", () => {
    expect(sameProductToCall([{ ...o("pending", null, "X"), id: "a" }, { ...o("pending", null, "X"), id: "b" }])).toHaveLength(2);
  });

  it("does not match two orders with no product at all", () => {
    expect(sameProductToCall([{ ...o("pending", null, null), id: "a" }, { ...o("pending", null, null), id: "b" }])).toEqual([]);
  });
});

describe("formatPhone", () => {
  it("groups an 8-digit Tunisian number 2-3-3", () => {
    expect(formatPhone("92422344")).toBe("92 422 344");
  });

  it("groups a 10-digit Libyan number 3-3-4", () => {
    expect(formatPhone("0912345678")).toBe("091 234 5678");
  });

  it("strips spaces first and leaves anything else as typed", () => {
    expect(formatPhone(" 924 22344 ")).toBe("92 422 344");
    expect(formatPhone("+21692422344")).toBe("+21692422344");
    expect(formatPhone("")).toBe("");
  });
});
