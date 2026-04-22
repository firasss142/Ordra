import { describe, it, expect } from "vitest";
import {
  getLocaleForMarket,
  getDirectionForLocale,
} from "@/lib/locale-routing";

describe("getLocaleForMarket", () => {
  it("returns fr for Tunisia (tn)", () => {
    expect(getLocaleForMarket("tn")).toBe("fr");
  });

  it("returns ar for Libya (ly)", () => {
    expect(getLocaleForMarket("ly")).toBe("ar");
  });

  it("defaults to fr for super_admin with null market", () => {
    expect(getLocaleForMarket(null)).toBe("fr");
  });
});

describe("getDirectionForLocale", () => {
  it("returns rtl for Arabic", () => {
    expect(getDirectionForLocale("ar")).toBe("rtl");
  });

  it("returns ltr for French", () => {
    expect(getDirectionForLocale("fr")).toBe("ltr");
  });
});
