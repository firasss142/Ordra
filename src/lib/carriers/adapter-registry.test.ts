import { describe, test, expect } from "vitest";
import {
  getCarrierAdapter,
  hasCarrierAdapter,
  listAdapterDescriptors,
  getAdapterDescriptor,
} from "./adapter-registry";
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
});
