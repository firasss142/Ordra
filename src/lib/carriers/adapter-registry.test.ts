import { describe, test, expect } from "vitest";
import {
  getCarrierAdapter,
  hasCarrierAdapter,
  listAdapterDescriptors,
  getAdapterDescriptor,
  adapterSupportsMarket,
} from "./adapter-registry";
import { NavexAdapter } from "./navex-adapter";
import { DexpressAdapter } from "./dexpress/adapter";

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

describe("hasCarrierAdapter", () => {
  test("returns true for known adapter", () => {
    expect(hasCarrierAdapter("navex")).toBe(true);
    expect(hasCarrierAdapter("dexpress")).toBe(true);
  });

  test("returns false for unknown adapter", () => {
    expect(hasCarrierAdapter("unknown")).toBe(false);
    expect(hasCarrierAdapter("")).toBe(false);
  });
});

describe("adapter descriptors", () => {
  test("listAdapterDescriptors returns all registered adapters", () => {
    const list = listAdapterDescriptors();
    const codes = list.map((d) => d.code).sort();
    expect(codes).toEqual(["dexpress", "navex"]);
  });

  test("each descriptor has label, credential fields, and marks secrets", () => {
    for (const d of listAdapterDescriptors()) {
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.credentialFields.length).toBeGreaterThan(0);
      const hasSecret = d.credentialFields.some((f) => f.secret);
      expect(hasSecret).toBe(true);
    }
  });

  test("getAdapterDescriptor returns null for unknown code", () => {
    expect(getAdapterDescriptor("unknown")).toBeNull();
  });

  test("getAdapterDescriptor exposes navex credential keys", () => {
    const d = getAdapterDescriptor("navex");
    expect(d).not.toBeNull();
    const keys = d!.credentialFields.map((f) => f.key);
    expect(keys).toContain("token");
    expect(keys).toContain("sender_name");
  });

  test("getAdapterDescriptor exposes dexpress credential keys (portal auth shape)", () => {
    const d = getAdapterDescriptor("dexpress");
    expect(d).not.toBeNull();
    const keys = d!.credentialFields.map((f) => f.key);
    expect(keys).toEqual(["email", "password", "merchant_id", "from_state"]);
    const passwordField = d!.credentialFields.find((f) => f.key === "password")!;
    expect(passwordField.secret).toBe(true);
  });

  test("each descriptor declares its supported markets", () => {
    for (const d of listAdapterDescriptors()) {
      expect(Array.isArray(d.markets)).toBe(true);
      expect(d.markets.length).toBeGreaterThan(0);
    }
  });

  test("navex is scoped to Tunisia, dexpress to Libya", () => {
    expect(getAdapterDescriptor("navex")!.markets).toEqual(["tn"]);
    expect(getAdapterDescriptor("dexpress")!.markets).toEqual(["ly"]);
  });
});

describe("listAdapterDescriptors with market filter", () => {
  test("returns only navex when filtering by Tunisia (tn)", () => {
    const list = listAdapterDescriptors("tn");
    expect(list.map((d) => d.code)).toEqual(["navex"]);
  });

  test("returns only dexpress when filtering by Libya (ly)", () => {
    const list = listAdapterDescriptors("ly");
    expect(list.map((d) => d.code)).toEqual(["dexpress"]);
  });

  test("market filter is case-insensitive", () => {
    expect(listAdapterDescriptors("TN").map((d) => d.code)).toEqual(["navex"]);
    expect(listAdapterDescriptors("Ly").map((d) => d.code)).toEqual(["dexpress"]);
  });

  test("returns empty array for unknown market", () => {
    expect(listAdapterDescriptors("xx")).toEqual([]);
  });

  test("returns all descriptors when no market filter is provided", () => {
    const list = listAdapterDescriptors();
    expect(list.map((d) => d.code).sort()).toEqual(["dexpress", "navex"]);
  });
});

describe("adapterSupportsMarket", () => {
  test("returns true for navex + tn, dexpress + ly", () => {
    expect(adapterSupportsMarket("navex", "tn")).toBe(true);
    expect(adapterSupportsMarket("dexpress", "ly")).toBe(true);
  });

  test("returns false for navex + ly, dexpress + tn", () => {
    expect(adapterSupportsMarket("navex", "ly")).toBe(false);
    expect(adapterSupportsMarket("dexpress", "tn")).toBe(false);
  });

  test("returns false for unknown adapter code", () => {
    expect(adapterSupportsMarket("unknown", "tn")).toBe(false);
  });

  test("market code matching is case-insensitive", () => {
    expect(adapterSupportsMarket("navex", "TN")).toBe(true);
    expect(adapterSupportsMarket("dexpress", "LY")).toBe(true);
  });
});
