/**
 * Next-step presets for the action sheet. "Tomorrow 10:00" means 10:00 on the
 * market's clock: an agent in Tripoli promising a customer "demain 10h" is
 * talking about Tripoli, whatever timezone the browser happens to report.
 */

export function inTwoHours(now: number = Date.now()): string {
  return new Date(now + 2 * 3_600_000).toISOString();
}

/** Offset of `tz` from UTC at instant `ms`, in minutes. */
function offsetMinutes(ms: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

export function tomorrowAt(now: number, tz: string, hour: number): string {
  const local = new Date(now + offsetMinutes(now, tz) * 60_000);
  const guess = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1, hour, 0, 0);
  // Resolve the wall-clock time back to UTC with the offset in force then.
  return new Date(guess - offsetMinutes(guess, tz) * 60_000).toISOString();
}
