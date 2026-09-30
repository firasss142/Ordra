/**
 * Meta's 24-hour customer-service window. Free-form text (and free-form
 * images) may be sent only within 24 h of the customer's LAST inbound
 * message; outside it, only approved templates. This is Meta's rule, not an
 * Ordra choice — the composer and the send gate both read it from here.
 */

export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function windowClosesAt(lastInboundAt: string | Date | null | undefined): Date | null {
  if (!lastInboundAt) return null;
  const t = new Date(lastInboundAt).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t + SERVICE_WINDOW_MS);
}

export function isServiceWindowOpen(
  lastInboundAt: string | Date | null | undefined,
  now: Date = new Date(),
): boolean {
  const closes = windowClosesAt(lastInboundAt);
  return closes !== null && closes.getTime() > now.getTime();
}
