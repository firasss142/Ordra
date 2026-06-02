import { describe, test, expect } from "vitest";
import {
  getCarrierAdapter,
  hasCarrierAdapter,
  getAdapterDescriptor,
  adapterSupportsMarket,
  listAdapterDescriptors,
} from "./adapter-registry";
import { DarbAssabilAdapter } from "./darb-assabil-adapter";

describe("Darb Assabil registration", () => {
  test("hasCarrierAdapter recognises darb_assabil", () => {
    expect(hasCarrierAdapter("darb_assabil")).toBe(true);
  });

  test("getCarrierAdapter returns a DarbAssabilAdapter instance", () => {
    expect(getCarrierAdapter("darb_assabil")).toBeInstanceOf(DarbAssabilAdapter);
  });

  test("descriptor exposes api_key (secret), account_id and default_service_id", () => {
    const desc = getAdapterDescriptor("darb_assabil");
    expect(desc).not.toBeNull();
    expect(desc?.label).toBe("Darb Assabil");
    expect(desc?.defaultEndpoint).toBe("https://v2.sabil.ly");

    const keys = desc?.credentialFields.map((f) => f.key) ?? [];
    expect(keys).toContain("api_key");
    expect(keys).toContain("account_id");
    expect(keys).toContain("default_service_id");

    const apiKeyField = desc?.credentialFields.find((f) => f.key === "api_key");
    expect(apiKeyField?.secret).toBe(true);
  });

  test("is scoped to the Libya market only", () => {
    expect(adapterSupportsMarket("darb_assabil", "ly")).toBe(true);
    expect(adapterSupportsMarket("darb_assabil", "tn")).toBe(false);

    const lyCodes = listAdapterDescriptors("ly").map((d) => d.code);
    const tnCodes = listAdapterDescriptors("tn").map((d) => d.code);
    expect(lyCodes).toContain("darb_assabil");
    expect(tnCodes).not.toContain("darb_assabil");
  });
});
