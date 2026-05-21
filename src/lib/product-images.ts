import { uploadImageDataUrl } from "@/lib/upload-image";

const BUCKET = "product-images";
const MAX_BYTES = 4 * 1024 * 1024;

export type ProductImageUploadResult =
  | { ok: true; url: string }
  | { ok: false; error: string; status: number };

/**
 * Accepts a data URL (data:image/...;base64,...) and uploads it to the
 * product-images bucket under a deterministic
 * `${marketId}/${productId}/image.<ext>` path. Overwrites on each call so a
 * product keeps a single image that is replaced in place. Returns a
 * cache-busted public URL.
 */
export async function uploadProductImageDataUrl(
  marketId: string,
  productId: string,
  dataUrl: string,
): Promise<ProductImageUploadResult> {
  const ext = /^data:image\/([^;]+);/.exec(dataUrl)?.[1];
  if (!ext) return { ok: false, error: "Invalid data_url", status: 400 };

  const path = `${marketId}/${productId}/image.${ext}`;
  const result = await uploadImageDataUrl(dataUrl, {
    bucket: BUCKET,
    path,
    maxBytes: MAX_BYTES,
    upsert: true,
  });

  if (!result.ok) return result;

  const url = `${result.publicUrl}?v=${Date.now()}`;
  return { ok: true, url };
}
