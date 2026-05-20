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
// decideCityResolution — name-only, market-aware:
//   Tunisia (isDexpressMarket=false) → resolves to cities.id (orders.city_id)
//   Libya   (isDexpressMarket=true)  → resolves to a dexpress_states id
//                                      (orders.dexpress_state_id); city_id stays null
//
// The storefront city is always a value the customer picked from a constrained
// dropdown whose options mirror our destination tables, so an exact normalized
// name match is authoritative — no external_city_id path, no needs_review.
// ---------------------------------------------------------------------------
describe("decideCityResolution (pure) — Tunisia / cities path", () => {
  const base: CityResolverInput = {
    isDexpressMarket: false,
    nameMatch: null,
  };

  test("name match resolves to city_id — method 'name'", () => {
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

  test("returns unmatched when the city string matches nothing", () => {
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
    nameMatch: null,
  };

  test("name match resolves to dexpress_state_id, city_id null — method 'name'", () => {
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

  test("returns unmatched when the city string matches nothing", () => {
    expect(decideCityResolution(base)).toEqual({
      city_id: null,
      dexpress_state_id: null,
      match_method: "none",
    });
  });
});

// ---------------------------------------------------------------------------
// resolveCity — IO wrapper. Single-stage: normalize customer_city, exact-match
// against the market's destination table. No external_city_mappings read.
// ---------------------------------------------------------------------------
describe("resolveCity (IO wrapper)", () => {
  function mockClient(opts: {
    cityRows?: Array<{ id: string; market_id: string; name: string; name_ar: string | null }>;
    // dexpress_states has a single `name` column (Arabic) — no name_ar.
    dexpressRows?: Array<{ id: number; name: string }>;
  }) {
    const fromCalls: string[] = [];
    const client = {
      from: vi.fn((table: string) => {
        fromCalls.push(table);
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
        return {};
      }),
    };
    return { client, fromCalls };
  }

  // --- Tunisia / cities path ------------------------------------------------

  test("Tunisia: resolves via market-scoped name match on name", async () => {
    const { client, fromCalls } = mockClient({
      cityRows: [
        { id: "city-tunis", market_id: TN_MARKET_ID, name: "Tunis", name_ar: "تونس" },
        { id: "city-sfax", market_id: TN_MARKET_ID, name: "Sfax", name_ar: "صفاقس" },
      ],
    });
    const result = await resolveCity(client as never, {
      platform: "buybox",
      market_id: TN_MARKET_ID,
      customer_city: "  tunis ",
    });
    expect(result.match_method).toBe("name");
    expect(result.city_id).toBe("city-tunis");
    expect(result.dexpress_state_id).toBeNull();
    expect(fromCalls).toContain("cities");
    expect(fromCalls).not.toContain("dexpress_states");
  });

  test("Tunisia: resolves via name_ar", async () => {
    const { client } = mockClient({
      cityRows: [
        { id: "city-tunis", market_id: TN_MARKET_ID, name: "Tunis", name_ar: "تونس" },
      ],
    });
    const result = await resolveCity(client as never, {
      platform: "buybox",
      market_id: TN_MARKET_ID,
      customer_city: "تونس",
    });
    expect(result.match_method).toBe("name");
    expect(result.city_id).toBe("city-tunis");
  });

  test("Tunisia: returns unmatched when the city string matches nothing", async () => {
    const { client } = mockClient({
      cityRows: [
        { id: "city-tunis", market_id: TN_MARKET_ID, name: "Tunis", name_ar: "تونس" },
      ],
    });
    const result = await resolveCity(client as never, {
      platform: "buybox",
      market_id: TN_MARKET_ID,
      customer_city: "nowhere",
    });
    expect(result).toEqual({
      city_id: null,
      dexpress_state_id: null,
      match_method: "none",
    });
  });

  // --- Libya / Dexpress path ------------------------------------------------

  test("Libya: resolves via a dexpress_states name match", async () => {
    const { client, fromCalls } = mockClient({
      dexpressRows: [
        { id: 6, name: "مصراتة" },
        { id: 62, name: "طرابلس" },
      ],
    });
    const result = await resolveCity(client as never, {
      platform: "shopify",
      market_id: LY_MARKET_ID,
      customer_city: "  مصراتة ",
    });
    expect(result.match_method).toBe("name");
    expect(result.dexpress_state_id).toBe(6);
    expect(result.city_id).toBeNull();
    expect(fromCalls).toContain("dexpress_states");
    expect(fromCalls).not.toContain("cities");
  });

  test("Libya: returns unmatched when the city string matches nothing", async () => {
    const { client } = mockClient({
      dexpressRows: [{ id: 6, name: "مصراتة" }],
    });
    const result = await resolveCity(client as never, {
      platform: "shopify",
      market_id: LY_MARKET_ID,
      customer_city: "jcp",
    });
    expect(result).toEqual({
      city_id: null,
      dexpress_state_id: null,
      match_method: "none",
    });
  });

  test("returns unmatched without querying when customer_city is null", async () => {
    const { client, fromCalls } = mockClient({});
    const result = await resolveCity(client as never, {
      platform: "shopify",
      market_id: LY_MARKET_ID,
      customer_city: null,
    });
    expect(result.match_method).toBe("none");
    expect(fromCalls).not.toContain("dexpress_states");
    expect(fromCalls).not.toContain("cities");
  });

  test("never reads external_city_mappings", async () => {
    const { client, fromCalls } = mockClient({
      cityRows: [{ id: "city-tunis", market_id: TN_MARKET_ID, name: "Tunis", name_ar: "تونس" }],
    });
    await resolveCity(client as never, {
      platform: "buybox",
      market_id: TN_MARKET_ID,
      customer_city: "tunis",
    });
    expect(fromCalls).not.toContain("external_city_mappings");
  });
});
