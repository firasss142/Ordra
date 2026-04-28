import { encodeKeysetCursor, decodeKeysetCursor, type KeysetCursor } from "@/lib/cursor";

export type QueueCursor = KeysetCursor;

export const encodeQueueCursor = encodeKeysetCursor;
export const decodeQueueCursor = (raw: string | null | undefined): QueueCursor | null =>
  raw ? decodeKeysetCursor(raw) : null;

export const DEFAULT_QUEUE_PAGE_LIMIT = 50;
export const MAX_QUEUE_PAGE_LIMIT = 200;

export function clampQueueLimit(raw: string | null | undefined): number {
  const n = raw ? Number.parseInt(raw, 10) : DEFAULT_QUEUE_PAGE_LIMIT;
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_QUEUE_PAGE_LIMIT;
  return Math.min(MAX_QUEUE_PAGE_LIMIT, Math.max(1, n));
}

export function buildQueuePageMeta<T extends { created_at: string; id: string }>(
  rows: T[],
  limit: number,
): { rows: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeQueueCursor({ timestamp: last.created_at, id: last.id })
      : null;
  return { rows: pageRows, nextCursor };
}
