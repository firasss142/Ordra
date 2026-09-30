/**
 * Meta signs every webhook delivery with HMAC-SHA256 of the RAW body using
 * the app secret, sent as `X-Hub-Signature-256: sha256=<hex>`. The body must
 * be the exact bytes received — re-serialising parsed JSON breaks it.
 */
import { timingSafeEqual } from "crypto";
import { verifyHmacSignature } from "@/lib/webhook-validation";

export function verifyWebhookSignature(rawBody: string, header: string | null | undefined, appSecret: string): boolean {
  if (!header || !appSecret || !rawBody) return false;
  const [scheme, hex] = header.split("=", 2);
  if (scheme !== "sha256" || !hex || !/^[0-9a-f]+$/i.test(hex)) return false;
  try {
    return verifyHmacSignature(rawBody, hex, appSecret);
  } catch {
    return false;
  }
}

/** Constant-time equality for the GET handshake's verify token. */
export function verifyTokenMatches(given: string | null | undefined, expected: string | null | undefined): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
