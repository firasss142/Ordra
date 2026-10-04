import { describe, it, expect } from "vitest";
import { cityLabel } from "./city-names";

describe("cityLabel", () => {
  it("gives the French name of a Libyan city Darb writes in Arabic", () => {
    expect(cityLabel("طرابلس", "fr")).toBe("Tripoli");
    expect(cityLabel("بنغازي", "fr")).toBe("Benghazi");
    expect(cityLabel("الكفرة", "fr")).toBe("Koufra");
  });
  it("matches the spelling variants Darb and storefronts produce", () => {
    expect(cityLabel("أجدابيا", "fr")).toBe("Ajdabiya");
    expect(cityLabel("اجدابيا", "fr")).toBe("Ajdabiya");
    expect(cityLabel(" مصراته ", "fr")).toBe("Misrata");
  });
  it("keeps the carrier's own words in Arabic, and anything it does not know", () => {
    expect(cityLabel("طرابلس", "ar")).toBe("طرابلس");
    expect(cityLabel("قرية مجهولة", "fr")).toBe("قرية مجهولة");
    expect(cityLabel("Sfax", "fr")).toBe("Sfax");
    expect(cityLabel("Sfax", "ar")).toBe("Sfax");
  });
});
