import { describe, test, expect, vi } from "vitest";
import {
  decideProductResolution,
  resolveProduct,
  type ProductResolverInput,
} from "./product-resolver";

describe("decideProductResolution (pure)", () => {
  const base: ProductResolverInput = {
    mappingRow: null,
    skuProductId: null,
    nameProductId: null,
  };

  test("explicit mapping wins — returns product + variant, method 'mapping'", () => {
    const result = decideProductResolution({
      ...base,
      mappingRow: { product_id: "prod-1", product_variant_id: "var-1" },
      // even when sku/name would also match, the mapping takes precedence
      skuProductId: "prod-other",
      nameProductId: "prod-other-2",
    });
    expect(result).toEqual({
      product_id: "prod-1",
      product_variant_id: "var-1",
      match_method: "mapping",
    });
  });

  test("mapping with null variant resolves product, leaves variant null", () => {
    const result = decideProductResolution({
      ...base,
      mappingRow: { product_id: "prod-1", product_variant_id: null },
    });
    expect(result).toEqual({
      product_id: "prod-1",
      product_variant_id: null,
      match_method: "mapping",
    });
  });

  test("falls back to SKU match when no mapping — method 'sku'", () => {
    const result = decideProductResolution({
      ...base,
      skuProductId: "prod-sku",
      nameProductId: "prod-name",
    });
    expect(result).toEqual({
      product_id: "prod-sku",
      product_variant_id: null,
      match_method: "sku",
    });
  });

  test("falls back to name match when no mapping and no SKU — method 'name'", () => {
    const result = decideProductResolution({
      ...base,
      nameProductId: "prod-name",
    });
    expect(result).toEqual({
      product_id: "prod-name",
      product_variant_id: null,
      match_method: "name",
    });
  });

  test("returns unmatched when nothing resolves", () => {
    const result = decideProductResolution(base);
    expect(result).toEqual({
      product_id: null,
      product_variant_id: null,
      match_method: "none",
    });
  });
});

describe("resolveProduct (IO wrapper)", () => {
  // Minimal market-scoped Supabase mock: a maybeSingle()-terminated chain.
  function mockClient(opts: {
    mappingRow?: unknown;
    skuRow?: unknown;
    nameRow?: unknown;
  }) {
    const fromCalls: string[] = [];
    const eqCalls: Array<{ table: string; col: string; val: unknown }> = [];
    const client = {
      from: vi.fn((table: string) => {
        fromCalls.push(table);
        const chain: Record<string, unknown> = {};
        chain.select = vi.fn(() => chain);
        chain.eq = vi.fn((col: string, val: unknown) => {
          eqCalls.push({ table, col, val });
          return chain;
        });
        chain.ilike = vi.fn(() => chain);
        chain.limit = vi.fn(() => chain);
        let row: unknown = null;
        if (table === "storefront_product_mappings") row = opts.mappingRow ?? null;
        if (table === "products") {
          // first products read = sku, second = name (handled by call order)
          row = undefined; // set below
        }
        chain.maybeSingle = vi.fn(async () => {
          if (table === "storefront_product_mappings") {
            return { data: opts.mappingRow ?? null, error: null };
          }
          // products: distinguish sku vs name by whether .ilike was called
          const usedIlike = (chain.ilike as ReturnType<typeof vi.fn>).mock.calls.length > 0;
          return {
            data: usedIlike ? opts.nameRow ?? null : opts.skuRow ?? null,
            error: null,
          };
        });
        return chain;
      }),
    };
    return { client, fromCalls, eqCalls };
  }

  test("returns the mapping row's product when one exists, without touching products", async () => {
    const { client, fromCalls } = mockClient({
      mappingRow: { product_id: "prod-1", product_variant_id: "var-1" },
    });
    const result = await resolveProduct(client as never, {
      storefront_id: "sf-1",
      market_id: "mkt-1",
      external_variant_id: "48611571007703",
      sku: null,
      product_name: "Quran",
    });
    expect(result.match_method).toBe("mapping");
    expect(result.product_id).toBe("prod-1");
    expect(result.product_variant_id).toBe("var-1");
    // short-circuits — no products query needed
    expect(fromCalls).not.toContain("products");
  });

  test("falls through to SKU then name, all market-scoped", async () => {
    const { client, eqCalls } = mockClient({
      mappingRow: null,
      skuRow: null,
      nameRow: { id: "prod-name" },
    });
    const result = await resolveProduct(client as never, {
      storefront_id: "sf-1",
      market_id: "mkt-1",
      external_variant_id: null,
      sku: "SKU-1",
      product_name: "Quran",
    });
    expect(result.match_method).toBe("name");
    expect(result.product_id).toBe("prod-name");
    // every products read is market-scoped
    const productMarketFilters = eqCalls.filter(
      (c) => c.table === "products" && c.col === "market_id",
    );
    expect(productMarketFilters.length).toBeGreaterThan(0);
    expect(productMarketFilters.every((c) => c.val === "mkt-1")).toBe(true);
  });

  test("returns unmatched when no variant id, no sku match, no name match", async () => {
    const { client } = mockClient({ mappingRow: null, skuRow: null, nameRow: null });
    const result = await resolveProduct(client as never, {
      storefront_id: "sf-1",
      market_id: "mkt-1",
      external_variant_id: "999",
      sku: null,
      product_name: "Unknown Product",
    });
    expect(result).toEqual({
      product_id: null,
      product_variant_id: null,
      match_method: "none",
    });
  });

  test("skips the mapping lookup entirely when there is no external_variant_id", async () => {
    const { client, fromCalls } = mockClient({ skuRow: { id: "prod-sku" } });
    const result = await resolveProduct(client as never, {
      storefront_id: "sf-1",
      market_id: "mkt-1",
      external_variant_id: null,
      sku: "SKU-1",
      product_name: "Quran",
    });
    expect(result.match_method).toBe("sku");
    expect(fromCalls).not.toContain("storefront_product_mappings");
  });
});
