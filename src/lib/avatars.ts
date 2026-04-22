import { createAdminClient } from "@/lib/supabase/server";

const BUCKET = "avatars";
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

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
  dataUrl: string
): Promise<AvatarUploadResult> {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return { ok: false, error: "Invalid avatar data", status: 400 };

  const mime = match[1].toLowerCase();
  if (!ALLOWED.has(mime)) {
    return { ok: false, error: "Unsupported image format", status: 400 };
  }

  const buffer = Buffer.from(match[2], "base64");
  if (buffer.byteLength > MAX_BYTES) {
    return { ok: false, error: "Image exceeds 2 MB", status: 413 };
  }

  const ext = mime.split("/")[1];
  const path = `${userId}/avatar.${ext}`;

  const admin = createAdminClient();
  const { error } = await admin.storage
    .from(BUCKET)
    .upload(path, buffer, { contentType: mime, upsert: true });

  if (error) {
    return { ok: false, error: "Upload failed", status: 500 };
  }

  const { data } = admin.storage.from(BUCKET).getPublicUrl(path);
  // Cache-bust so the old cached image is replaced in the browser after update.
  const url = `${data.publicUrl}?v=${Date.now()}`;
  return { ok: true, url };
}
