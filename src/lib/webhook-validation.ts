import { createHmac, timingSafeEqual } from "crypto";

export function verifyHmacSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  if (!secret) throw new Error("Webhook secret is required");
  if (!payload) throw new Error("Payload is required");
  if (!signature) return false;

  const expected = createHmac("sha256", secret).update(payload).digest("hex");

  try {
    return timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expected, "hex")
    );
  } catch {
    return false;
  }
}
