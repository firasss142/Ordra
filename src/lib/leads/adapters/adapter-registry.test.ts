import { describe, test, expect } from "vitest";
import { getLeadAdapter } from "./index";

describe("getLeadAdapter", () => {
  test("returns ManualAdapter for 'manual'", () => {
    const a = getLeadAdapter("manual");
    expect(a.platform).toBe("manual");
  });

  test("returns MetaAdapter stub for 'meta'", () => {
    const a = getLeadAdapter("meta");
    expect(a.platform).toBe("meta");
  });

  test("returns WhatsAppAdapter stub for 'whatsapp'", () => {
    const a = getLeadAdapter("whatsapp");
    expect(a.platform).toBe("whatsapp");
  });

  test("throws for unknown platform", () => {
    expect(() => getLeadAdapter("carrier-pigeon")).toThrow(
      "Unknown lead platform"
    );
  });
});

describe("ManualAdapter.mapToInternalLead", () => {
  test("maps valid payload to internal lead", () => {
    const a = getLeadAdapter("manual");
    const data = a.mapToInternalLead({
      source: "manual_call",
      customer_name: "Jane",
      customer_phone: "+216111",
      customer_city: "Tunis",
    });
    expect(data.customer_name).toBe("Jane");
    expect(data.source).toBe("manual_call");
    expect(data.source_platform).toBe("manual");
    expect(data.source_external_id).toBeNull();
  });

  test("throws on missing required fields", () => {
    const a = getLeadAdapter("manual");
    expect(() => a.mapToInternalLead({ source: "manual_call" })).toThrow();
  });

  test("throws on invalid source", () => {
    const a = getLeadAdapter("manual");
    expect(() =>
      a.mapToInternalLead({
        source: "carrier_pigeon",
        customer_name: "X",
        customer_phone: "+1",
      })
    ).toThrow("Invalid source");
  });
});

describe("MetaAdapter / WhatsAppAdapter (stubs)", () => {
  test("Meta validateWebhook throws not-implemented", () => {
    const a = getLeadAdapter("meta");
    expect(() => a.validateWebhook("", {}, "")).toThrow("not implemented");
  });

  test("WhatsApp validateWebhook throws not-implemented", () => {
    const a = getLeadAdapter("whatsapp");
    expect(() => a.validateWebhook("", {}, "")).toThrow("not implemented");
  });
});
