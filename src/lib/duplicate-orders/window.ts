import type { SupabaseClient } from "@supabase/supabase-js";
import { getMarketSetting } from "@/lib/settings/getMarketSetting";

/**
 * How far apart two orders may be and still read as the same order placed
 * twice. Per-market, from the settings table — `duplicate_window_hours` has
 * existed in the settings UI since the duplicate badge shipped, but detection
 * hardcoded 24h and never read it. 24 keeps today's behaviour as the default.
 */
export const DEFAULT_DUPLICATE_WINDOW_HOURS = 24;

/**
 * The narrower window inside which a duplicate is confident enough to be
 * pre-selected for deletion on the review screen.
 *
 * One hour, from the measured shape of the data: same-product pairs in Libya
 * have a median gap of 0.2h (a double-submit), while in Tunisia the median is
 * 118h — a customer genuinely re-buying a consumable. An hour is the line
 * between "the form was submitted twice" and "they ordered again", so it is
 * what decides which rows arrive pre-ticked.
 */
export const DEFAULT_AUTOSELECT_WINDOW_HOURS = 1;

/** A week. Past this, "duplicate" stops meaning anything useful. */
const MAX_WINDOW_HOURS = 168;

/**
 * Coerce a settings value into a usable window in whole hours.
 *
 * 0 is meaningful and distinct from unset: it disables the behaviour. A
 * negative value would invert the SQL comparison and silently match nothing,
 * so it clamps to 0 rather than being treated as absent.
 */
export function clampWindowHours(value: unknown, fallback: number): number {
  if (value === null || value === undefined || value === "") return fallback;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_WINDOW_HOURS, Math.max(0, Math.trunc(n)));
}

/** Resolve `duplicate_window_hours` for a market. */
export async function getDuplicateWindowHours(
  supabase: SupabaseClient,
  marketId: string,
): Promise<number> {
  const raw = await getMarketSetting(
    supabase,
    marketId,
    "duplicate_window_hours",
    String(DEFAULT_DUPLICATE_WINDOW_HOURS),
  );
  return clampWindowHours(raw, DEFAULT_DUPLICATE_WINDOW_HOURS);
}

/** Resolve `duplicate_autoselect_window_hours` for a market. */
export async function getAutoselectWindowHours(
  supabase: SupabaseClient,
  marketId: string,
): Promise<number> {
  const raw = await getMarketSetting(
    supabase,
    marketId,
    "duplicate_autoselect_window_hours",
    String(DEFAULT_AUTOSELECT_WINDOW_HOURS),
  );
  return clampWindowHours(raw, DEFAULT_AUTOSELECT_WINDOW_HOURS);
}
