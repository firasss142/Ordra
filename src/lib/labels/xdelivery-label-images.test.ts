// @vitest-environment node
import { describe, it, expect } from "vitest";
import { xdeliveryLabelImages } from "./xdelivery-label-images";

describe("xdeliveryLabelImages", () => {
  it("draws their Code-128 and our QR as PNG data URLs", async () => {
    const img = await xdeliveryLabelImages("611791217700001", "6f1c2a9e-0000-4000-8000-000000001042", "thermal");
    expect(img.barcodePng).toMatch(/^data:image\/png;base64,iVBOR/);
    expect(img.qrPng).toMatch(/^data:image\/png;base64,iVBOR/);
  });

  it("refuses a barcode Code-128 cannot carry rather than print an unreadable label", async () => {
    await expect(xdeliveryLabelImages("é", "x", "a4x2")).rejects.toThrow();
  });
});
