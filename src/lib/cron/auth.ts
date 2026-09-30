/**
 * Who may call a /api/cron/* route: pg_net with the vault's cron_secret, or
 * an operator with the same secret as a Bearer token. Extracted from the
 * meta-ads-sync route so the WhatsApp drain does not grow a fourth copy; the
 * older routes keep theirs until they are touched.
 */

export function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function isCronAuthorized(req: { headers: { get(name: string): string | null } }, expected: string | undefined): boolean {
  if (!expected) return false;
  const xSecret = req.headers.get("x-cron-secret");
  if (xSecret && timingSafeEqualString(xSecret, expected)) return true;
  const auth = req.headers.get("authorization") ?? "";
  if (auth.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length);
    if (timingSafeEqualString(token, expected)) return true;
  }
  return false;
}
