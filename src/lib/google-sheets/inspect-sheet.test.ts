import { describe, it, expect, vi, afterEach } from "vitest";
import { classifySheetError, missingHeaders, getServiceAccountEmail } from "./inspect-sheet";
import { sheetRange } from "./client";

describe("missingHeaders", () => {
  it("lists the required columns a sheet does not have, case- and space-insensitively", () => {
    expect(missingHeaders([" qr code", "Phone", "Products"], ["QR Code", "Phone", "Total Price", "Products"])).toEqual([
      "Total Price",
    ]);
  });
  it("is empty when everything is there", () => {
    expect(missingHeaders(["QR Code", "Phone"], ["QR Code", "Phone"])).toEqual([]);
  });
});

describe("classifySheetError", () => {
  it("reads a 403 or 404 as 'the service account cannot open this sheet'", () => {
    expect(classifySheetError({ code: 403, message: "The caller does not have permission" })).toBe("no_access");
    expect(classifySheetError({ code: 404, message: "Requested entity was not found." })).toBe("no_access");
  });
  it("reads an unparseable range as a wrong tab name", () => {
    expect(classifySheetError({ code: 400, message: "Unable to parse range: 'Ordres'!A1:Z" })).toBe("no_tab");
  });
  it("reads anything else as unknown", () => {
    expect(classifySheetError(new Error("socket hang up"))).toBe("unknown");
  });
});

describe("getServiceAccountEmail", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("returns the client_email and nothing else", () => {
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", JSON.stringify({ client_email: "ordra@x.iam.gserviceaccount.com", private_key: "k" }));
    expect(getServiceAccountEmail()).toBe("ordra@x.iam.gserviceaccount.com");
  });
  it("is null when the credential is missing or malformed", () => {
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", "");
    expect(getServiceAccountEmail()).toBeNull();
    vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_JSON", "{not json");
    expect(getServiceAccountEmail()).toBeNull();
  });
});

describe("sheetRange", () => {
  it("quotes the tab and doubles an apostrophe inside it, as A1 notation requires", () => {
    expect(sheetRange("Orders", "A1:Z1")).toBe("'Orders'!A1:Z1");
    expect(sheetRange("Bachir's orders", "A2:Z")).toBe("'Bachir''s orders'!A2:Z");
  });
});
