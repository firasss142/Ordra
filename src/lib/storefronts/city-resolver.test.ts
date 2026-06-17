import { describe, test, expect, vi } from "vitest";
import {
  decideCityResolution,
  normalizeCityName,
  resolveCity,
  resolvedCustomerCity,
  type CityResolverInput,
} from "./city-resolver";
import type { CityResolution } from "./resolver-types";
import { LY_MARKET_ID, TN_MARKET_ID } from "@/lib/markets";

describe("resolvedCustomerCity (pure)", () => {
  const none: CityResolution = {
    city_id: null,
    dexpress_state_id: null,
    darb_destination_id: null,
    darb_city: null,
    darb_area: null,
    match_method: "none",
  };

  test("snapshots the canonical Darb city when Darb resolved it", () => {
    // The raw storefront string ("  طرابلس ") is replaced by the canonical city
    // so the dispatch modal's resolveDarbDestination matches reliably.
    expect(
      resolvedCustomerCity(
        { ...none, darb_city: "طرابلس", match_method: "name" },
        "  طرابلس ",
      ),
    ).toBe("طرابلس");
  });

  test("keeps the raw customer_city when Darb did not resolve (Tunisia / Dexpress / unmatched)", () => {
    expect(resolvedCustomerCity({ ...none, city_id: "c1", match_method: "name" }, "Tunis")).toBe("Tunis");
    expect(resolvedCustomerCity({ ...none, dexpress_state_id: 6, match_method: "name" }, "تاجوراء")).toBe("تاجوراء");
    expect(resolvedCustomerCity(none, "nowhere")).toBe("nowhere");
  });
});

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
      darb_destination_id: null,
      darb_city: null,
      darb_area: null,
      match_method: "name",
    });
  });

  test("returns unmatched when the city string matches nothing", () => {
    expect(decideCityResolution(base)).toEqual({
      city_id: null,
      dexpress_state_id: null,
      darb_destination_id: null,
      darb_city: null,
      darb_area: null,
      match_method: "none",
    });
  });
});

describe("decideCityResolution (pure) — Libya / Darb-first, Dexpress fallback", () => {
  const base: CityResolverInput = {
    isDexpressMarket: true,
    nameMatch: null,
  };

  test("Darb match (single-area city) resolves to darb_destination_id + area, no dexpress", () => {
    const result = decideCityResolution({
      ...base,
      nameMatch: { kind: "darb", id: 42, city: "مصراتة", area: "مصراتة" },
    });
    expect(result).toEqual({
      city_id: null,
      dexpress_state_id: null,
      darb_destination_id: 42,
      darb_city: "مصراتة",
      darb_area: "مصراتة",
      match_method: "name",
    });
  });

  test("Darb match (multi-area city, area undecided) snapshots the city but leaves the id/area null", () => {
    // طرابلس has many areas; the area is chosen at dispatch, so intake stores the
    // canonical city only — no darb_destination_id yet, but still a confident match.
    const result = decideCityResolution({
      ...base,
      nameMatch: { kind: "darb", id: null, city: "طرابلس", area: null },
    });
    expect(result).toEqual({
      city_id: null,
      dexpress_state_id: null,
      darb_destination_id: null,
      darb_city: "طرابلس",
      darb_area: null,
      match_method: "name",
    });
  });

  test("Dexpress fallback match resolves to dexpress_state_id when Darb does not serve the city", () => {
    const result = decideCityResolution({
      ...base,
      nameMatch: { kind: "dexpress", id: 6 },
    });
    expect(result).toEqual({
      city_id: null,
      dexpress_state_id: 6,
      darb_destination_id: null,
      darb_city: null,
      darb_area: null,
      match_method: "name",
    });
  });

  test("returns unmatched when neither Darb nor Dexpress recognise the city", () => {
    expect(decideCityResolution(base)).toEqual({
      city_id: null,
      dexpress_state_id: null,
      darb_destination_id: null,
      darb_city: null,
      darb_area: null,
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
    // darb_destinations rows (one per city/area pair), active only.
    darbRows?: Array<{ id: number; city: string; area: string }>;
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
        if (table === "darb_destinations") {
          // resolver awaits .select().eq("is_active", true) directly (a list)
          return {
            select: vi.fn(() => ({
              eq: vi.fn(async () => ({ data: opts.darbRows ?? [], error: null })),
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
      darb_destination_id: null,
      darb_city: null,
      darb_area: null,
      match_method: "none",
    });
  });

  // --- Libya / Darb-first, Dexpress fallback --------------------------------

  test("Libya: a single-area Darb city resolves to darb_destination_id + area (no dexpress lookup)", async () => {
    const { client, fromCalls } = mockClient({
      darbRows: [
        { id: 11, city: "مصراتة", area: "مصراتة" },
        { id: 12, city: "اجدابيا", area: "اجدابيا" },
      ],
      dexpressRows: [{ id: 6, name: "مصراتة" }],
    });
    const result = await resolveCity(client as never, {
      platform: "shopify",
      market_id: LY_MARKET_ID,
      customer_city: "  مصراتة ",
    });
    expect(result.match_method).toBe("name");
    expect(result.darb_destination_id).toBe(11);
    expect(result.darb_city).toBe("مصراتة");
    expect(result.darb_area).toBe("مصراتة");
    expect(result.dexpress_state_id).toBeNull();
    expect(result.city_id).toBeNull();
    expect(fromCalls).toContain("darb_destinations");
    // Darb matched, so we never fall through to the Dexpress lookup.
    expect(fromCalls).not.toContain("dexpress_states");
  });

  test("Libya: a multi-area Darb city snapshots the city, leaves id/area null (area picked at dispatch)", async () => {
    const { client } = mockClient({
      darbRows: [
        { id: 20, city: "طرابلس", area: "طرابلس" },
        { id: 21, city: "طرابلس", area: "تاجوراء" },
      ],
    });
    const result = await resolveCity(client as never, {
      platform: "shopify",
      market_id: LY_MARKET_ID,
      customer_city: "طرابلس",
    });
    expect(result.match_method).toBe("name");
    expect(result.darb_city).toBe("طرابلس");
    expect(result.darb_area).toBeNull();
    expect(result.darb_destination_id).toBeNull();
    expect(result.dexpress_state_id).toBeNull();
  });

  test("Libya: falls back to a dexpress_states match when Darb does not serve the city", async () => {
    // تاجوراء is a Dexpress state but NOT a standalone Darb city — fallback path.
    const { client, fromCalls } = mockClient({
      darbRows: [{ id: 20, city: "طرابلس", area: "تاجوراء" }],
      dexpressRows: [{ id: 52, name: "تاجوراء" }],
    });
    const result = await resolveCity(client as never, {
      platform: "shopify",
      market_id: LY_MARKET_ID,
      customer_city: "تاجوراء",
    });
    expect(result.match_method).toBe("name");
    expect(result.dexpress_state_id).toBe(52);
    expect(result.darb_destination_id).toBeNull();
    expect(result.darb_city).toBeNull();
    expect(fromCalls).toContain("darb_destinations");
    expect(fromCalls).toContain("dexpress_states");
  });

  test("Libya: returns unmatched when neither Darb nor Dexpress recognise the city", async () => {
    const { client } = mockClient({
      darbRows: [{ id: 11, city: "مصراتة", area: "مصراتة" }],
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
      darb_destination_id: null,
      darb_city: null,
      darb_area: null,
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
    expect(fromCalls).not.toContain("darb_destinations");
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
