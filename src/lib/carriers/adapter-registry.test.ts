import { describe, test, expect } from "vitest";
import { getCarrierAdapter } from "./adapter-registry";
import { NavexAdapter } from "./navex-adapter";
import { DexpressAdapter } from "./dexpress-adapter";

describe("getCarrierAdapter", () => {
  test("returns NavexAdapter for 'navex'", () => {
    const adapter = getCarrierAdapter("navex");
    expect(adapter).toBeInstanceOf(NavexAdapter);
  });

  test("returns DexpressAdapter for 'dexpress'", () => {
    const adapter = getCarrierAdapter("dexpress");
    expect(adapter).toBeInstanceOf(DexpressAdapter);
  });

  test("throws for unknown carrier code", () => {
    expect(() => getCarrierAdapter("unknown")).toThrow(
      "Unknown carrier code: unknown"
    );
  });

  test("returns new instance each call", () => {
    const a = getCarrierAdapter("navex");
    const b = getCarrierAdapter("navex");
    expect(a).not.toBe(b);
  });
});
