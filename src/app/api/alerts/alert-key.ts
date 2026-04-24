export const VALID_ALERT_TYPES = new Set([
  "dispatch_failure",
  "carrier_webhook_stale",
  "overdue_callback",
  "unassigned_overflow",
  "return_bottleneck",
  "low_stock",
  "stock_depleted",
  "agent_inactive",
]);

export function parseAlertKey(key: string): { type: string; entityId: string } | null {
  const idx = key.indexOf(":");
  if (idx <= 0 || idx === key.length - 1) return null;
  const type = key.slice(0, idx);
  const entityId = key.slice(idx + 1);
  if (!VALID_ALERT_TYPES.has(type)) return null;
  return { type, entityId };
}
