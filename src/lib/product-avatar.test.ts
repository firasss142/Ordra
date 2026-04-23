import { describe, it, expect } from "vitest";
import { getProductAvatarColor, getProductInitial } from "./product-avatar";

const AVATAR_COLORS = ["#E8D5B7","#D5E8D4","#B7D5E8","#E8B7D5","#D5D5B7","#E8D5D5","#B7E8D5","#D5B7E8"];

describe("getProductInitial", () => {
  it("returns uppercase first character", () => {
    expect(getProductInitial("Samsung TV")).toBe("S");
  });

  it("returns uppercase for lowercase input", () => {
    expect(getProductInitial("iphone 15")).toBe("I");
  });

  it("trims leading whitespace", () => {
    expect(getProductInitial("  Nike Shoes")).toBe("N");
  });

  it("returns ? for empty string", () => {
    expect(getProductInitial("")).toBe("?");
  });

  it("returns ? for whitespace-only string", () => {
    expect(getProductInitial("   ")).toBe("?");
  });
});

describe("getProductAvatarColor", () => {
  it("returns a color from the palette", () => {
    const color = getProductAvatarColor("Samsung TV");
    expect(AVATAR_COLORS).toContain(color);
  });

  it("returns consistent color for the same name", () => {
    expect(getProductAvatarColor("Nike Air Max")).toBe(getProductAvatarColor("Nike Air Max"));
  });

  it("returns different colors for different names (hash distribution)", () => {
    const colors = new Set(["Apple Watch","Samsung TV","Sony Headphones","Nike Shoes","Adidas Cap","LG Monitor","Dell Laptop","HP Printer"].map(getProductAvatarColor));
    expect(colors.size).toBeGreaterThan(1);
  });

  it("handles empty string without throwing", () => {
    expect(() => getProductAvatarColor("")).not.toThrow();
    expect(AVATAR_COLORS).toContain(getProductAvatarColor(""));
  });
});
