/**
 * Fetch a public https image and push it through Meta's resumable upload,
 * returning the header handle a MARKETING template's example needs.
 * Server-only.
 */
import type { WhatsAppClient } from "./client";

const MAX_BYTES = 5 * 1024 * 1024;

export async function uploadHeaderImage(client: WhatsAppClient, imageUrl: string): Promise<string> {
  const res = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`image fetch failed (${res.status})`);
  const mime = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0].trim();
  if (!/^image\/(jpeg|png)$/i.test(mime)) throw new Error(`unsupported image type ${mime}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) throw new Error("image must be 1 byte to 5 MB");
  const name = imageUrl.split("/").pop()?.split("?")[0] || "header.jpg";
  const session = await client.createUploadSession({ fileLength: buf.byteLength, fileType: mime, fileName: name });
  return client.uploadChunk({ sessionId: session, bytes: buf });
}
