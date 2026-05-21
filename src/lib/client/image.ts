const MAX_BYTES = 5 * 1024 * 1024;

export type AvatarDecodeError = "not-image" | "too-large" | "decode-failed";

export type AvatarDecodeResult =
  | { ok: true; dataUrl: string }
  | { ok: false; error: AvatarDecodeError };

/**
 * Generic image decoder: validates type/size, downscales via canvas, and
 * returns a base64 data URL. Used for avatars and product images alike.
 */
export const decodeImageFile = decodeAvatarFile;

export async function decodeAvatarFile(
  file: File,
  maxSize = 512
): Promise<AvatarDecodeResult> {
  if (!file.type.startsWith("image/")) return { ok: false, error: "not-image" };
  if (file.size > MAX_BYTES) return { ok: false, error: "too-large" };

  try {
    const bitmap = await createImageBitmap(file);
    const ratio = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * ratio);
    const h = Math.round(bitmap.height * ratio);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { ok: false, error: "decode-failed" };
    ctx.drawImage(bitmap, 0, 0, w, h);

    const mime = file.type === "image/png" ? "image/png" : "image/jpeg";
    return { ok: true, dataUrl: canvas.toDataURL(mime, 0.85) };
  } catch {
    return { ok: false, error: "decode-failed" };
  }
}

const MESSAGES: Record<AvatarDecodeError, string> = {
  "not-image": "Fichier image requis",
  "too-large": "Image trop volumineuse (max 5 Mo)",
  "decode-failed": "Impossible de lire l'image",
};

export function avatarErrorMessage(error: AvatarDecodeError): string {
  return MESSAGES[error];
}
