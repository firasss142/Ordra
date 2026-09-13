import type { SupabaseClient } from "@supabase/supabase-js";
import { todayInMarket } from "@/lib/dates/market-day";
import { scopeToMarketId, isValidScope } from "@/lib/markets";

/**
 * "Le chauffeur est passé" — the per-site pickup switch.
 *
 * Every Darb upload carries `isPickup: true`, which is the right default: they
 * collect from our warehouse. But an order uploaded AFTER the driver has
 * physically been still books a pickup in their system, and their driver is
 * sent back for parcels that did not exist when he was here. This switch says
 * "already done today" for one site.
 *
 * NO STORED BOOLEAN, NO CRON. We store the INSTANT of the press and compare it
 * to the market's local day on every read. A stamp from yesterday simply is not
 * today, so pickup returns to its `true` default at local midnight on its own.
 * A nightly job that clears a boolean is a moving part that can fail or run
 * late — and its failure mode is pickup silently staying off into the next day,
 * which is the very problem this feature exists to prevent.
 *
 * Scope is the SITE, not the market: Tripoli and Benghazi are two buildings on
 * two Darb accounts with two drivers who arrive independently. One market-wide
 * switch would mark Benghazi collected because Tripoli was.
 */

export const PICKUP_KEY_PREFIX = "darb_pickup_disabled:";

/**
 * `marketTimezone` resolves ONLY the market UUID; a market *code* ("ly") falls
 * through its lookup and silently yields Africa/Tunis — an hour off, which here
 * would move midnight and reset the switch at the wrong moment. Callers hold
 * either form (routes have the UUID, client surfaces often the code), so accept
 * both rather than depend on every call site remembering which one is safe.
 */
function toMarketId(market: string | null | undefined): string | null | undefined {
  return isValidScope(market) ? scopeToMarketId(market) : market;
}

/** The `settings.key` holding one site's switch. */
export function pickupSettingKey(warehouseId: string): string {
  return `${PICKUP_KEY_PREFIX}${warehouseId}`;
}

export interface PickupDisabledValue {
  disabled_at: string;
  by?: string | null;
}

/**
 * Unwraps the two shapes a `settings.value` comes in — the bare object and the
 * `{ value: … }` wrapper — as `getMarketSetting` does, since rows were written
 * both ways over time.
 */
function unwrap(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if ("value" in obj && obj.value && typeof obj.value === "object") {
    return obj.value as Record<string, unknown>;
  }
  return obj;
}

/** The press instant, or null when the row is absent or unreadable. */
export function readDisabledAt(raw: unknown): Date | null {
  const obj = unwrap(raw);
  const stamp = obj?.disabled_at;
  if (typeof stamp !== "string") return null;
  const at = new Date(stamp);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * Is pickup switched off for this site right now?
 *
 * True only when the press happened on the CURRENT market-local calendar day.
 * Anything else — no row, an unparsable stamp, a press from any earlier day —
 * means pickup is on, which is the safe direction: at worst the driver is asked
 * to come for parcels that are genuinely waiting.
 */
export function isPickupDisabledNow(
  raw: unknown,
  marketId: string | null | undefined,
  now: Date = new Date()
): boolean {
  const at = readDisabledAt(raw);
  if (!at) return false;
  const id = toMarketId(marketId);
  return todayInMarket(id, at) === todayInMarket(id, now);
}

/**
 * Reads the switch for one site. Returns false on any read error: a settings
 * table we cannot reach must not silently cancel pickups.
 */
export async function isSitePickupDisabled(
  supabase: SupabaseClient,
  marketId: string,
  warehouseId: string,
  now: Date = new Date()
): Promise<boolean> {
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("market_id", marketId)
    .eq("key", pickupSettingKey(warehouseId))
    .maybeSingle<{ value: unknown }>();
  return isPickupDisabledNow(data?.value, marketId, now);
}

/**
 * Who may move the switch, and in which direction.
 *
 * The two directions are NOT symmetric. Switching OFF is an observation — the
 * agent watched the driver load and drive away, and is the only person standing
 * in that building, so they must be able to record it. Switching back ON before
 * midnight contradicts that observation and re-summons a driver, so it belongs
 * to a manager: a wrong press is then undone by someone who owns the decision,
 * not quietly by whoever made it.
 *
 * A warehouse agent is confined to their own building, and one with no site
 * assigned may touch nothing — unassigned must never read as unrestricted.
 */
export function canTogglePickup(input: {
  role: string;
  /** The agent's own `users.warehouse_id`; null for managers (normal) or unassigned. */
  actorSiteId: string | null;
  targetSiteId: string;
  /** true = switching pickup off; false = turning it back on before midnight. */
  turningOff: boolean;
}): boolean {
  if (input.role === "super_admin" || input.role === "market_manager") return true;
  if (input.role !== "warehouse_agent") return false;
  // An agent records the driver's departure; they do not reverse it.
  if (!input.turningOff) return false;
  return input.actorSiteId !== null && input.actorSiteId === input.targetSiteId;
}
