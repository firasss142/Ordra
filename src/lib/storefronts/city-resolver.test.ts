import { describe, test, expect, vi } from "vitest";
import {
  decideCityResolution,
  normalizeCityName,
  resolveCity,
  type CityResolverInput,
} from "./city-resolver";
import { LY_MARKET_ID, TN_MARKET_ID } from "@/lib/markets";

describe("normalizeCityName (pure)", () => {
  test("trims and lowercases", () => {
    expect(normalizeCityName("  Tunis  ")).toBe("tunis");
  });
  test("collapses internal whitespace", () => {
    expect(normalizeCityName("Ben  Arous")).toBe("ben arous");
  });
  test("leaves Arabic text intact apart from trimming", () => {
    expect(normalizeCityName("  مصراتة ")).toBe("مصراتة");
  });
  test("returns empty string for nullish input", () => {
    expect(normalizeCityName(null)).toBe("");
    expect(normalizeCityName(undefined)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// decideCityResolution — market-aware:
//   Tunisia (isDexpressMarket=false) → resolves to cities.id (orders.city_id)
//   Libya   (isDexpressMarket=true)  → resolves to a dexpress_states id
//                                      (orders.dexpress_state_id); city_id stays null
// ---------------------------------------------------------------------------
describe("decideCityResolution (pure) — Tunisia / cities path", () => {
  const base: CityResolverInput = {
    isDexpressMarket: false,
    mappingRow: null,
    storefrontMarketId: TN_MARKET_ID,
    nameMatch: null,
  };

  test("external-id mapping in the same market wins — method 'external_id'", () => {
    const result = decideCityResolution({
      ...base,
      mappingRow: {
        city_id: "city-1",
        city_market_id: TN_MARKET_ID,
        dexpress_state_id: null,
      },
      nameMatch: { kind: "city", id: "city-other", market_id: TN_MARKET_ID },
    });
    expect(result).toEqual({
      city_id: "city-1",
      dexpress_state_id: null,
      match_method: "external_id",
    });
  });

  test("external-id mapping in a DIFFERENT market is rejected — method 'market_mismatch'", () => {
    const result = decideCityResolution({
      ...base,
      mappingRow: {
        city_id: "city-tn",
        city_market_id: TN_MARKET_ID,
        dexpress_state_id: null,
      },
      storefrontMarketId: "some-other-market",
    });
    expect(result).toEqual({
      city_id: null,
      dexpress_state_id: null,
      match_method: "market_mismatch",
    });
  });

  test("falls back to name match when no mapping — method 'name'", () => {
    const result = decideCityResolution({
      ...base,
      nameMatch: { kind: "city", id: "city-name", market_id: TN_MARKET_ID },
    });
    expect(result).toEqual({
      city_id: "city-name",
      dexpress_state_id: null,
      match_method: "name",
    });
  });

  test("returns unmatched when nothing resolves", () => {
    expect(decideCityResolution(base)).toEqual({
      city_id: null,
      dexpress_state_id: null,
      match_method: "none",
    });
  });
});

describe("decideCityResolution (pure) — Libya / Dexpress path", () => {
  const base: CityResolverInput = {
    isDexpressMarket: true,
    mappingRow: null,
    storefrontMarketId: LY_MARKET_ID,
    nameMatch: null,
  };

  test("mapping with a dexpress_state_id resolves to dexpress_state_id, city_id null", () => {
    const result = decideCityResolution({
      ...base,
      mappingRow: {
        city_id: null,
        city_market_id: null,
        dexpress_state_id: 16,
      },
      // even if a name match exists, the explicit mapping wins
      nameMatch: { kind: "dexpress", id: 99 },
    });
    expect(result).toEqual({
      city_id: null,
      dexpress_state_id: 16,
      match_method: "external_id",
    });
  });

  test("mapping present but dexpress_state_id null → falls through (incomplete mapping, not applied)", () => {
    // This is exactly order #AC3FDD16's broken state: a mapping row exists but
    // carries no Dexpress state. It must NOT be treated as resolved.
    const result = decideCityResolution({
      ...base,
      mappingRow: {
        city_id: "stale-city-uuid",
        city_market_id: LY_MARKET_ID,
        dexpress_state_id: null,
      },
      nameMatch: { kind: "dexpress", id: 42 },
    });
    // falls through to the name match rather than applying the empty mapping
    expect(result).toEqual({
      city_id: null,
      dexpress_state_id: 42,
      match_method: "name",
    });
  });

  test("incomplete mapping AND no name match → unmatched", () => {
    const result = decideCityResolution({
      ...base,
      mappingRow: {
        city_id: "stale-city-uuid",
        city_market_id: LY_MARKET_ID,
        dexpress_state_id: null,
      },
    });
    expect(result).toEqual({
      city_id: null,
      dexpress_state_id: null,
      match_method: "none",
    });
  });

  test("falls back to a Dexpress name match — method 'name'", () => {
    const result = decideCityResolution({
      ...base,
      nameMatch: { kind: "dexpress", id: 6 },
    });
    expect(result).toEqual({
      city_id: null,
      dexpress_state_id: 6,
      match_method: "name",
    });
  });

  test("returns unmatched when nothing resolves", () => {
    expect(decideCityResolution(base)).toEqual({
      city_id: null,
      dexpress_state_id: null,
      match_method: "none",
    });
  });
});

// ---------------------------------------------------------------------------
// resolveCity — IO wrapper
// ---------------------------------------------------------------------------
describe("resolveCity (IO wrapper)", () => {
  function mockClient(opts: {
    mappingRow?: unknown;
    cityRows?: Array<{ id: string; market_id: string; name: string; name_ar: string | null }>;
    // dexpress_states has a single `name` column (Arabic) — no name_ar.
    dexpressRows?: Array<{ id: number; name: string }>;
  }) {
    const fromCalls: string[] = [];
    const client = {
      from: vi.fn((table: string) => {
        fromCalls.push(table);
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn(() => chain);
        chain.eq = vi.fn(() => chain);
        chain.maybeSingle = vi.fn(async () => {
          if (table === "external_city_mappings") {
            return { data: opts.mappingRow ?? null, error: null };
          }
          return { data: null, error: null };
        });
        if (table === "cities") {
          // resolver awaits .select().eq() directly (returns a list)
          return {
            select: vi.fn(() => ({
              eq: vi.fn(async () => ({ data: opts.cityRows ?? [], error: null })),
            })),
          };
        }
        if (table === "dexpress_states") {
          // resolver awaits .select().eq("status", 1) directly (returns a list)
          return {
            select: vi.fn(() => ({
              eq: vi.fn(async () => ({ data: opts.dexpressRows ?? [], error: null })),
            })),
          };
        }
        return chain;
      }),
    };
    return { client, fromCalls };
  }

  // --- Tunisia / cities path ------------------------------------------------

  test("Tunisia: resolves via external_city_mappings when present and same-market", async () => {
    const { client, fromCalls } = mockClient({
      mappingRow: {
        city_id: "city-1",
        dexpress_state_id: null,
        cities: { id: "city-1", market_id: TN_MARKET_ID },
      },
    });
    const result = await resolveCity(client as never, {
      platform: "shopify",
      market_id: TN_MARKET_ID,
      external_city_id: "3",
      customer_city: "Tunis",
    });
    expect(result.match_method).toBe("external_id");
    expect(result.city_id).toBe("city-1");
    expect(result.dexpress_state_id).toBeNull();
    expect(fromCalls).not.toContain("cities"); // short-circuits
  });

  test("Tunisia: flags market_mismatch when the mapped city is in another market", async () => {
    const { client } = mockClient({
      mappingRow: {
        city_id: "city-x",
        dexpress_state_id: null,
        cities: { id: "city-x", market_id: "some-other-market" },
      },
    });
    const result = await resolveCity(client as never, {
      platform: "shopify",
      market_id: TN_MARKET_ID,
      external_city_id: "3",
      customer_city: "Tunis",
    });
    expect(result.match_method).toBe("market_mismatch");
    expect(result.city_id).toBeNull();
  });

  test("Tunisia: falls back to market-scoped name match (name or name_ar)", async () => {
    const { client, fromCalls } = mockClient({
      mappingRow: null,
      cityRows: [
        { id: "city-tunis", market_id: TN_MARKET_ID, name: "Tunis", name_ar: "تونس" },
        { id: "city-sfax", market_id: TN_MARKET_ID, name: "Sfax", name_ar: "صفاقس" },
      ],
    });
    const result = await resolveCity(client as never, {
      platform: "shopify",
      market_id: TN_MARKET_ID,
      external_city_id: null,
      customer_city: "  tunis ",
    });
    expect(result.match_method).toBe("name");
    expect(result.city_id).toBe("city-tunis");
    expect(result.dexpress_state_id).toBeNull();
    expect(fromCalls).toContain("cities");
    expect(fromCalls).not.toContain("dexpress_states");
  });

  // --- Libya / Dexpress path ------------------------------------------------

  test("Libya: resolves via external_city_mappings.dexpress_state_id", async () => {
    const { client, fromCalls } = mockClient({
      mappingRow: {
        city_id: null,
        dexpress_state_id: 16,
        cities: null,
      },
    });
    const result = await resolveCity(client as never, {
      platform: "buybox",
      market_id: LY_MARKET_ID,
      external_city_id: "51",
      customer_city: "اجدابيا",
    });
    expect(result.match_method).toBe("external_id");
    expect(result.dexpress_state_id).toBe(16);
    expect(result.city_id).toBeNull();
    expect(fromCalls).not.toContain("dexpress_states"); // short-circuits
  });

  test("Libya: a mapping row with null dexpress_state_id falls through to the name match", async () => {
    // #AC3FDD16 scenario — mapping exists but is incomplete.
    const { client, fromCalls } = mockClient({
      mappingRow: {
        city_id: "stale-city-uuid",
        dexpress_state_id: null,
        cities: { id: "stale-city-uuid", market_id: LY_MARKET_ID },
      },
      // dexpress_states.name holds the Arabic name.
      dexpressRows: [
        { id: 51, name: "اجدابيا" },
        { id: 6, name: "مصراتة" },
      ],
    });
    const result = await resolveCity(client as never, {
      platform: "buybox",
      market_id: LY_MARKET_ID,
      external_city_id: "51",
      customer_city: "اجدابيا",
    });
    expect(result.match_method).toBe("name");
    expect(result.dexpress_state_id).toBe(51);
    expect(result.city_id).toBeNull();
    expect(fromCalls).toContain("dexpress_states");
  });

  test("Libya: falls back to a dexpress_states name match", async () => {
    const { client, fromCalls } = mockClient({
      mappingRow: null,
      dexpressRows: [
        { id: 6, name: "مصراتة" },
        { id: 62, name: "طرابلس" },
      ],
    });
    const result = await resolveCity(client as never, {
      platform: "buybox",
      market_id: LY_MARKET_ID,
      external_city_id: null,
      customer_city: "  مصراتة ",
    });
    expect(result.match_method).toBe("name");
    expect(result.dexpress_state_id).toBe(6);
    expect(result.city_id).toBeNull();
    expect(fromCalls).toContain("dexpress_states");
    expect(fromCalls).not.toContain("cities");
  });

  test("Libya: returns unmatched when external id misses and the city string matches nothing", async () => {
    const { client } = mockClient({
      mappingRow: null,
      dexpressRows: [{ id: 6, name: "مصراتة" }],
    });
    const result = await resolveCity(client as never, {
      platform: "buybox",
      market_id: LY_MARKET_ID,
      external_city_id: "999",
      customer_city: "jcp",
    });
    expect(result).toEqual({
      city_id: null,
      dexpress_state_id: null,
      match_method: "none",
    });
  });

  test("skips the external-id lookup entirely when there is no external_city_id", async () => {
    const { client, fromCalls } = mockClient({
      cityRows: [{ id: "city-tunis", market_id: TN_MARKET_ID, name: "Tunis", name_ar: "تونس" }],
    });
    const result = await resolveCity(client as never, {
      platform: "shopify",
      market_id: TN_MARKET_ID,
      external_city_id: null,
      customer_city: "tunis",
    });
    expect(result.match_method).toBe("name");
    expect(fromCalls).not.toContain("external_city_mappings");
  });
});
