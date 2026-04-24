import { uploadImageDataUrl } from "@/lib/upload-image";

const BUCKET = "avatars";
const MAX_BYTES = 2 * 1024 * 1024;

export type AvatarUploadResult =
  | { ok: true; url: string }
  | { ok: false; error: string; status: number };

/**
 * Accepts a data URL (data:image/...;base64,...) and uploads it to the avatars
 * bucket under a deterministic `${userId}/avatar.<ext>` path. Overwrites on
 * each call so old avatars are replaced in place.
 */
export async function uploadAvatarDataUrl(
  userId: string,
  dataUrl: string,
): Promise<AvatarUploadResult> {
  const ext = /^data:image\/([^;]+);/.exec(dataUrl)?.[1];
  if (!ext) return { ok: false, error: "Invalid avatar data", status: 400 };

  const path = `${userId}/avatar.${ext}`;
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
