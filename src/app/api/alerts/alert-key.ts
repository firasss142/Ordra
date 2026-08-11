import { ALERT_TYPES } from "@/lib/alerts/catalogue";

/**
 * Derived, never hand-listed. This set was maintained by hand and fell behind
 * the engine, so an alert of a newly added type could be shown but not
 * acknowledged or snoozed — the key was rejected before it reached the table.
 */
export const VALID_ALERT_TYPES: ReadonlySet<string> = new Set<string>(ALERT_TYPES);

export function parseAlertKey(key: string): { type: string; entityId: string } | null {
  const idx = key.indexOf(":");
  if (idx <= 0 || idx === key.length - 1) return null;
  const type = key.slice(0, idx);
  const entityId = key.slice(idx + 1);
  if (!VALID_ALERT_TYPES.has(type)) return null;
  return { type, entityId };
}
