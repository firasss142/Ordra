import { describe, it, expect } from "vitest";
import { productThumbUrl } from "../thumb-url";

const BASE = "https://vshynigvgrlihngozuwb.supabase.co/storage/v1";
const OBJ = `${BASE}/object/public/product-images/mkt/prod/image.png`;

describe("productThumbUrl", () => {
  it("rewrites a Supabase public object URL to the render endpoint", () => {
    const url = productThumbUrl(OBJ, 80);
    expect(url).toContain("/storage/v1/render/image/public/product-images/mkt/prod/image.png");
    expect(url).not.toContain("/object/public/");
  });

  it("asks for the size it will actually be shown at", () => {
    const url = new URL(productThumbUrl(OBJ, 80)!);
    expect(url.searchParams.get("width")).toBe("80");
    expect(url.searchParams.get("height")).toBe("80");
    expect(url.searchParams.get("resize")).toBe("cover");
    expect(url.searchParams.get("quality")).toBe("70");
  });

  it("keeps the ?v= cache-buster so a re-upload still busts the CDN", () => {
    const url = new URL(productThumbUrl(`${OBJ}?v=1787764975140`, 80)!);
    expect(url.searchParams.get("v")).toBe("1787764975140");
    expect(url.searchParams.get("width")).toBe("80");
  });

  it("leaves a non-Supabase URL alone", () => {
    // Storefront-hosted images exist; rewriting them would 404.
    const foreign = "https://cdn.shopify.com/x/image.jpg";
    expect(productThumbUrl(foreign, 80)).toBe(foreign);
  });

  it("leaves a Supabase URL that is not a public object alone", () => {
    const signed = `${BASE}/object/sign/product-images/mkt/prod/image.png?token=abc`;
    expect(productThumbUrl(signed, 80)).toBe(signed);
  });

  it("returns null for no image", () => {
    expect(productThumbUrl(null, 80)).toBeNull();
    expect(productThumbUrl("", 80)).toBeNull();
  });

  it("is idempotent — a URL already pointing at the render endpoint is not rewritten twice", () => {
    const once = productThumbUrl(OBJ, 80)!;
    expect(productThumbUrl(once, 80)).toBe(once);
  });

  it("rounds a fractional size to a whole pixel count", () => {
    const url = new URL(productThumbUrl(OBJ, 41.5)!);
    expect(url.searchParams.get("width")).toBe("42");
  });

  it("survives a malformed URL instead of throwing", () => {
    expect(productThumbUrl("not a url", 80)).toBe("not a url");
  });
});
