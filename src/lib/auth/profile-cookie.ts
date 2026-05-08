import type { Role } from "@/types";

export const PROFILE_COOKIE = "oms_profile";
export const PROFILE_TTL_MS = 5 * 60 * 1000;

export interface ProfilePayload {
  user_id: string;
  email: string;
  full_name: string;
  avatar_url: string | null;
  role: Role;
  market_id: string | null;
  market_code: "tn" | "ly" | null;
  exp: number;
}

async function keyFor(usage: "sign" | "verify"): Promise<CryptoKey> {
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      "ENCRYPTION_KEY environment variable is not set — required to sign/verify the oms_profile cookie",
    );
  }
  const raw = new TextEncoder().encode(secret);
  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

export async function signProfile(payload: ProfilePayload): Promise<string> {
  const key = await keyFor("sign");
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const sig = await crypto.subtle.sign("HMAC", key, data);
  const sigHex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${sigHex}`;
}

export async function verifyProfile(
  cookie: string,
): Promise<ProfilePayload | null> {
  const dot = cookie.lastIndexOf(".");
  if (dot === -1) return null;
  const payloadB64 = cookie.slice(0, dot);
  const sigHex = cookie.slice(dot + 1);

  let payload: ProfilePayload;
  try {
    payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf-8"),
    );
  } catch {
    return null;
  }
  if (payload.exp < Date.now()) return null;

  const hexMatch = sigHex.match(/.{2}/g);
  if (!hexMatch) return null;

  const key = await keyFor("verify");
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const sigBytes = new Uint8Array(hexMatch.map((h) => parseInt(h, 16)));
  const valid = await crypto.subtle.verify("HMAC", key, sigBytes, data);
  return valid ? payload : null;
}
