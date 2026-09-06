import { describe, test, expect } from "vitest";
import { isDarbStickerPayload } from "../sticker-payload";

describe("isDarbStickerPayload", () => {
  test("a bare number is a sticker, leading zeros included", () => {
    expect(isDarbStickerPayload("1213123")).toBe(true);
    expect(isDarbStickerPayload("000000227104")).toBe(true);
    expect(isDarbStickerPayload("  7700001 ")).toBe(true);
  });

  test("anything but digits is a mis-scan", () => {
    expect(isDarbStickerPayload("https://sabil.ly/track/7700011")).toBe(false);
    expect(isDarbStickerPayload("SH2057634")).toBe(false);
    expect(isDarbStickerPayload("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")).toBe(false);
    expect(isDarbStickerPayload("")).toBe(false);
    expect(isDarbStickerPayload("77 00001")).toBe(false);
  });
});
