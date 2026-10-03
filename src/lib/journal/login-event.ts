/**
 * Sign-in events for Journaux (auth.login / auth.login_failed). Server-only.
 *
 * The journal never keeps a full address or a raw ip: an account is named by
 * a masked e-mail (`ad•••@oms.local`) and a client by a short ip hash.
 */
import { createHash } from "crypto";

export const LOGIN_FAILURES_WINDOW_MIN = 15;
export const LOGIN_FAILURES_MAX = 30;

/** `admin@oms.local` → `ad•••@oms.local`. Lower-cased, trimmed. */
export function maskEmail(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 0) return "•••";
  return `${e.slice(0, Math.min(2, at))}•••${e.slice(at)}`;
}

/**
 * The account a failure counts against: sha256 of the full, normalised
 * address, 12 hex chars. The masked label is for reading only — `ag•••@oms.local`
 * is agent1.tn AND agent2.tn, and the limit and the alert must not merge them.
 */
export function accountKey(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 12);
}

/** First 12 hex chars of sha256(first ip of x-forwarded-for), or null. */
export function ipHash(forwardedFor: string | null | undefined): string | null {
  const ip = forwardedFor?.split(",")[0]?.trim();
  if (!ip) return null;
  return createHash("sha256").update(ip).digest("hex").slice(0, 12);
}
