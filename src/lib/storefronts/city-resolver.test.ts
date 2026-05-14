import { describe, test, expect, vi } from "vitest";
import {
  decideCityResolution,
  normalizeCityName,
  resolveCity,
  type CityResolverInput,
} from "./city-resolver";

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

describe("decideCityResolution (pure)", () => {
  const base: CityResolverInput = {
    mappingRow: null,
    storefrontMarketId: "mkt-1",
    nameMatch: null,
  };

  test("external-id mapping in the same market wins — method 'external_id'", () => {
    const result = decideCityResolution({
      ...base,
      mappingRow: {
        city_id: "city-1",
        city_market_id: "mkt-1",
        dexpress_state_id: 10,
      },
      nameMatch: { id: "city-other", market_id: "mkt-1" },
    });
    expect(result).toEqual({
      city_id: "city-1",
      dexpress_state_id: 10,
      match_method: "external_id",
    });
  });

  test("external-id mapping in a DIFFERENT market is rejected — method 'market_mismatch'", () => {
    const result = decideCityResolution({
      ...base,
      mappingRow: {
        city_id: "city-tn",
        city_market_id: "mkt-tunisia",
        dexpress_state_id: null,
      },
      storefrontMarketId: "mkt-libya",
    });
    // city_id is NOT applied — wrong market must never be silently accepted
    expect(result).toEqual({
      city_id: null,
      dexpress_state_id: null,
      match_method: "market_mismatch",
    });
  });

  test("falls back to name match when no mapping — method 'name'", () => {
    const result = decideCityResolution({
      ...base,
      nameMatch: { id: "city-name", market_id: "mkt-1" },
    });
    expect(result).toEqual({
      city_id: "city-name",
      dexpress_state_id: null,
      match_method: "name",
    });
  });

  test("returns unmatched when nothing resolves", () => {
    const result = decideCityResolution(base);
    expect(result).toEqual({
      city_id: null,
      dexpress_state_id: null,
      match_method: "none",
    });
  });
});

describe("resolveCity (IO wrapper)", () => {
  function mockClient(opts: {
    mappingRow?: unknown;
    cityRows?: Array<{ id: string; market_id: string; name: string; name_ar: string | null }>;
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
        // cities name lookup returns a list the resolver scans in-memory
        chain.then = undefined;
        if (table === "cities") {
          // .eq("market_id", ...) then awaited directly
          chain.eq = vi.fn(() => chain);
          return {
            select: vi.fn(() => ({
              eq: vi.fn(async () => ({ data: opts.cityRows ?? [], error: null })),
            })),
          };
        }
        return chain;
      }),
    };
    return { client, fromCalls };
  }

  test("resolves via external_city_mappings when present and same-market", async () => {
    const { client, fromCalls } = mockClient({
      mappingRow: {
        city_id: "city-1",
        dexpress_state_id: 5,
        cities: { id: "city-1", market_id: "mkt-1" },
      },
    });
    const result = await resolveCity(client as never, {
      platform: "buybox",
      market_id: "mkt-1",
      external_city_id: "3",
      customer_city: "مصراتة",
    });
    expect(result.match_method).toBe("external_id");
    expect(result.city_id).toBe("city-1");
    expect(result.dexpress_state_id).toBe(5);
    expect(fromCalls).not.toContain("cities"); // short-circuits
  });

  test("flags market_mismatch when the mapped city is in another market", async () => {
    const { client } = mockClient({
      mappingRow: {
        city_id: "city-tn",
        dexpress_state_id: null,
        cities: { id: "city-tn", market_id: "mkt-tunisia" },
      },
    });
    const result = await resolveCity(client as never, {
      platform: "buybox",
      market_id: "mkt-libya",
      external_city_id: "3",
      customer_city: "Tunis",
    });
    expect(result.match_method).toBe("market_mismatch");
    expect(result.city_id).toBeNull();
  });

  test("falls back to market-scoped name match (name or name_ar)", async () => {
    const { client, fromCalls } = mockClient({
      mappingRow: null,
      cityRows: [
        { id: "city-misrata", market_id: "mkt-libya", name: "Misrata", name_ar: "مصراتة" },
        { id: "city-tripoli", market_id: "mkt-libya", name: "Tripoli", name_ar: "طرابلس" },
      ],
    });
    const result = await resolveCity(client as never, {
      platform: "buybox",
      market_id: "mkt-libya",
      external_city_id: null,
      customer_city: "  مصراتة ",
    });
    expect(result.match_method).toBe("name");
    expect(result.city_id).toBe("city-misrata");
    expect(fromCalls).toContain("cities");
  });

  test("returns unmatched when external id misses and the city string matches nothing", async () => {
    const { client } = mockClient({
      mappingRow: null,
      cityRows: [
        { id: "city-misrata", market_id: "mkt-libya", name: "Misrata", name_ar: "مصراتة" },
      ],
    });
    const result = await resolveCity(client as never, {
      platform: "buybox",
      market_id: "mkt-libya",
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
      cityRows: [
        { id: "city-tunis", market_id: "mkt-tn", name: "Tunis", name_ar: "تونس" },
      ],
    });
    const result = await resolveCity(client as never, {
      platform: "shopify",
      market_id: "mkt-tn",
      external_city_id: null,
      customer_city: "tunis",
    });
    expect(result.match_method).toBe("name");
    expect(fromCalls).not.toContain("external_city_mappings");
  });
});
