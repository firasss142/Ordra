import { uploadImageDataUrl } from "@/lib/upload-image";

const BUCKET = "logos";
const MAX_BYTES = 2 * 1024 * 1024;

/** What can carry an uploaded logo: a storefront (boutique) or a carrier account. */
export type LogoOwner = "storefront" | "carrier";

export type LogoUploadResult =
  | { ok: true; url: string }
  | { ok: false; error: string; status: number };

/**
 * Uploads a data URL to the public `logos` bucket at `<owner>s/<id>/logo.<ext>`
 * — one deterministic path per row, overwritten in place, like avatars. The
 * returned URL carries a `?v=` stamp because the path itself never changes.
 */
export async function uploadLogoDataUrl(
  owner: LogoOwner,
  id: string,
  dataUrl: string,
): Promise<LogoUploadResult> {
  const ext = /^data:image\/([^;]+);/.exec(dataUrl)?.[1];
  if (!ext) return { ok: false, error: "Invalid logo data", status: 400 };

  const result = await uploadImageDataUrl(dataUrl, {
    bucket: BUCKET,
    path: `${owner}s/${id}/logo.${ext}`,
    maxBytes: MAX_BYTES,
    upsert: true,
  });
  if (!result.ok) return result;

  return { ok: true, url: `${result.publicUrl}?v=${Date.now()}` };
}
