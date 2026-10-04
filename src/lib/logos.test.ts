import { describe, test, expect, vi, beforeEach } from "vitest";

const mockUpload = vi.fn();
vi.mock("@/lib/upload-image", () => ({
  uploadImageDataUrl: (...args: unknown[]) => mockUpload(...args),
}));

import { uploadLogoDataUrl } from "./logos";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

describe("uploadLogoDataUrl", () => {
  beforeEach(() => {
    mockUpload.mockReset();
    mockUpload.mockResolvedValue({ ok: true, path: "x", publicUrl: "https://cdn/logos/x.png", signedUrl: null });
  });

  test("puts a storefront's logo under storefronts/<id>/ in the logos bucket, overwriting", async () => {
    await uploadLogoDataUrl("storefront", "sf-1", PNG);
    expect(mockUpload).toHaveBeenCalledWith(PNG, expect.objectContaining({ bucket: "logos", path: "storefronts/sf-1/logo.png", upsert: true }));
  });

  test("puts a carrier's logo under carriers/<id>/", async () => {
    await uploadLogoDataUrl("carrier", "c-9", "data:image/jpeg;base64,/9j/");
    expect(mockUpload).toHaveBeenCalledWith("data:image/jpeg;base64,/9j/", expect.objectContaining({ path: "carriers/c-9/logo.jpeg" }));
  });

  test("returns a cache-busted public URL, since the path never changes", async () => {
    const r = await uploadLogoDataUrl("carrier", "c-9", PNG);
    expect(r.ok && r.url).toMatch(/^https:\/\/cdn\/logos\/x\.png\?v=\d+$/);
  });

  test("refuses something that is not an image data URL without touching storage", async () => {
    const r = await uploadLogoDataUrl("storefront", "sf-1", "hello");
    expect(r).toEqual({ ok: false, error: "Invalid logo data", status: 400 });
    expect(mockUpload).not.toHaveBeenCalled();
  });

  test("passes a storage failure through", async () => {
    mockUpload.mockResolvedValue({ ok: false, error: "Upload failed", status: 500 });
    expect(await uploadLogoDataUrl("storefront", "sf-1", PNG)).toEqual({ ok: false, error: "Upload failed", status: 500 });
  });
});
