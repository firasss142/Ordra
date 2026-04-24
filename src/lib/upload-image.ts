import { createAdminClient } from "@/lib/supabase/server";

export const UPLOAD_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export interface UploadImageOptions {
  bucket: string;
  path: string;
  maxBytes?: number;
  /** When true, overwrites an existing file at the same path. */
  upsert?: boolean;
  /** When set, returns a signed URL valid for this many seconds instead of a public URL. */
  signedUrlTtl?: number;
}

export type UploadImageResult =
  | { ok: true; path: string; publicUrl: string | null; signedUrl: string | null }
  | { ok: false; error: string; status: number };

/**
 * Parses a data URL, validates mime + size, uploads to Supabase storage via
 * the service-role admin client, and optionally returns a signed URL.
 */
export async function uploadImageDataUrl(
  dataUrl: string,
  opts: UploadImageOptions,
): Promise<UploadImageResult> {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return { ok: false, error: "Invalid data_url", status: 400 };

  const mime = match[1].toLowerCase();
  if (!UPLOAD_IMAGE_MIME.has(mime)) {
    return { ok: false, error: "Unsupported image format", status: 400 };
  }

  // Approximate size check before decoding to avoid allocating oversized buffers.
  const maxBytes = opts.maxBytes ?? 4 * 1024 * 1024;
  if (match[2].length * 0.75 > maxBytes) {
    return { ok: false, error: "Image too large", status: 413 };
  }

  const buffer = Buffer.from(match[2], "base64");

  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage
    .from(opts.bucket)
    .upload(opts.path, buffer, { contentType: mime, upsert: opts.upsert ?? false });

  if (uploadError) {
    return { ok: false, error: "Upload failed", status: 500 };
  }

  if (opts.signedUrlTtl) {
    const { data: signed, error: signError } = await admin.storage
      .from(opts.bucket)
      .createSignedUrl(opts.path, opts.signedUrlTtl);
    if (signError) {
      return { ok: false, error: "Failed to sign URL", status: 500 };
    }
    return {
      ok: true,
      path: opts.path,
      publicUrl: null,
      signedUrl: signed?.signedUrl ?? null,
    };
  }

  const { data } = admin.storage.from(opts.bucket).getPublicUrl(opts.path);
  return {
    ok: true,
    path: opts.path,
    publicUrl: data.publicUrl,
    signedUrl: null,
  };
}
