export interface EditLockKey {
  table: string;
  rowId: string;
}

export type EditLockListener = (key: EditLockKey) => void;

export interface EditLockRegistry {
  lock(table: string, rowId: string): void;
  unlock(table: string, rowId: string): void;
  isLocked(table: string, rowId: string): boolean;
  onUnlock(listener: EditLockListener): () => void;
}

function makeKey(table: string, rowId: string): string {
  return `${table}:${rowId}`;
}

/**
 * Refcounted edit-lock registry.
 *
 * - Multiple holders can lock the same (table, rowId); each lock must be
 *   matched by an unlock. The row is "locked" while any holder is active.
 * - `onUnlock` fires exactly once when the refcount drops to zero — used by
 *   the realtime bus consumer to flush a single revalidation per lock cycle.
 */
export function createEditLockRegistry(): EditLockRegistry {
  const counts = new Map<string, number>();
  const listeners = new Set<EditLockListener>();

  return {
    lock(table, rowId) {
      const k = makeKey(table, rowId);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    },
    unlock(table, rowId) {
      const k = makeKey(table, rowId);
      const current = counts.get(k) ?? 0;
      if (current === 0) return;
      const next = current - 1;
      if (next === 0) {
        counts.delete(k);
        for (const l of listeners) {
          try {
            l({ table, rowId });
          } catch (err) {
            // eslint-disable-next-line no-console
            console.error("[edit-lock] listener error", err);
          }
        }
      } else {
        counts.set(k, next);
      }
    },
    isLocked(table, rowId) {
      return (counts.get(makeKey(table, rowId)) ?? 0) > 0;
    },
    onUnlock(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
