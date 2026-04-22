/**
 * Keyset-cursor helpers for pagination. Cursors encode a (timestamp, id) pair
 * as `base64url(timestamp|id)`. Consumers pick the timestamp column that
 * matches their ORDER BY (e.g., `created_at` for orders, `updated_at` for
 * follow-ups) and pass it via the `timestampField` indirection.
 */

export interface KeysetCursor {
  /** ISO timestamp (created_at, updated_at, etc.) */
  timestamp: string;
  id: string;
}

export function encodeKeysetCursor(c: KeysetCursor): string {
  return Buffer.from(`${c.timestamp}|${c.id}`, "utf8").toString("base64url");
}

export function decodeKeysetCursor(raw: string): KeysetCursor | null {
  try {
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    const idx = decoded.indexOf("|");
    if (idx <= 0) return null;
    const timestamp = decoded.slice(0, idx);
    const id = decoded.slice(idx + 1);
    if (!/^\d{4}-\d{2}-\d{2}T/.test(timestamp) || !id) return null;
    return { timestamp, id };
  } catch {
    return null;
  }
}
