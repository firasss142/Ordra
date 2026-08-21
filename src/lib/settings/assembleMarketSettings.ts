import {
  DEFAULT_MARKET_SETTINGS,
  isValidMarketSettings,
  MARKET_SETTINGS_KEYS,
  type MarketSettings,
} from "@/types/settings";

/** One row as returned by `GET /api/settings/[marketId]`. */
export interface SettingRow {
  key: string;
  value: unknown;
}

/**
 * The PATCH route wraps scalars/arrays as `{ value: X }` but stores plain
 * objects (shift_config) as-is. Readers must handle both. This mirrors the
 * unwrap in `getMarketSetting` and the ad-hoc `row.value?.value ?? row.value`
 * scattered across clients, in one tested place.
 */
export function unwrapSettingValue(raw: unknown): unknown {
  if (
    raw !== null &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    "value" in raw
  ) {
    return (raw as { value: unknown }).value;
  }
  return raw;
}

/** The set of keys the type actually owns — anything else is ignored. */
const KNOWN_KEYS = new Set<string>(MARKET_SETTINGS_KEYS);

/**
 * Build a complete, valid `MarketSettings` from raw settings rows.
 *
 * Replaces the brittle hand-written `typeof` assembly in the settings client:
 * as the number of keys grew from ~10 to ~40, per-key guards became a place
 * where a forgotten key silently loads as `undefined`. Here every known key is
 * seeded from `DEFAULT_MARKET_SETTINGS`, then each stored row is applied only
 * if the resulting object still passes `isValidMarketSettings` — so a corrupt
 * or out-of-range stored value falls back to the default instead of surfacing
 * a value the next PATCH would reject. Unknown keys are dropped.
 */
export function assembleMarketSettings(rows: SettingRow[]): MarketSettings {
  const result: MarketSettings = { ...DEFAULT_MARKET_SETTINGS };

  for (const row of rows) {
    if (!KNOWN_KEYS.has(row.key)) continue;
    const value = unwrapSettingValue(row.value);
    // Probe: does the whole object stay valid with this key overridden?
    const candidate = { ...result, [row.key]: value } as unknown as Record<string, unknown>;
    if (isValidMarketSettings(candidate)) {
      (result as unknown as Record<string, unknown>)[row.key] = value;
    }
    // else: keep the seeded default for this key.
  }

  return result;
}
