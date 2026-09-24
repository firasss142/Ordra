import { describe, test, expect, vi } from "vitest";
import {
  decideProductResolution,
  resolveProduct,
  type ProductResolverInput,
} from "./product-resolver";

describe("decideProductResolution (pure)", () => {
  const base: ProductResolverInput = {
    mappingRow: null,
    variantSku: null,
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
    variantRow?: { id: string; product_id: string } | null;
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
          // Ces cas-ci ne mettent en scène aucune variante. Sans cette branche,
          // la lecture de `product_variants` retombait sur `opts.skuRow` et
          // toute correspondance par SKU produit se lisait « variant_sku ».
          if (table === "product_variants") {
            return { data: opts.variantRow ?? null, error: null };
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

/*
 * LE SKU D'UNE VARIANTE.
 *
 * Les boutiques envoient déjà des variantes — « القرآن-تدبر-وعمل-حجم-كبير »,
 * « أكمام…(white, 4 قطع ب 149 دل) » — et l'intake les aplatissait : les deux
 * chemins SKU et nom écrivaient `product_variant_id: null` en dur. Seule une
 * ligne de correspondance faite à la main pouvait nommer une variante, et
 * aucune des onze ne le faisait. Résultat : 0 commande sur 8 581 portait une
 * variante.
 *
 * Un SKU de variante résout DONC les deux : le produit et la taille.
 */
describe("decideProductResolution — le SKU d'une variante résout les deux", () => {
  const base: ProductResolverInput = {
    mappingRow: null,
    skuProductId: null,
    nameProductId: null,
    variantSku: null,
  };

  test("un SKU de variante rend le produit ET la variante", () => {
    expect(
      decideProductResolution({
        ...base,
        variantSku: { product_id: "prod-1", variant_id: "var-grand" },
      }),
    ).toEqual({
      product_id: "prod-1",
      product_variant_id: "var-grand",
      match_method: "variant_sku",
    });
  });

  /*
   * Les deux tables partagent UN SEUL espace de noms par marché depuis
   * 20260920162309, précisément pour que cette situation soit impossible. Si
   * elle survient malgré tout (données antérieures au garde-fou), la variante
   * l'emporte : c'est la réponse la plus précise, et laisser le produit gagner
   * serait la correspondance silencieusement fausse contre laquelle
   * `carrier-warehouse.ts` met déjà en garde.
   */
  test("à SKU égal, la variante bat le produit", () => {
    expect(
      decideProductResolution({
        ...base,
        variantSku: { product_id: "prod-1", variant_id: "var-grand" },
        skuProductId: "prod-autre",
      }).match_method,
    ).toBe("variant_sku");
  });

  test("une correspondance explicite bat quand même le SKU de variante", () => {
    expect(
      decideProductResolution({
        ...base,
        mappingRow: { product_id: "prod-map", product_variant_id: "var-map" },
        variantSku: { product_id: "prod-1", variant_id: "var-grand" },
      }).match_method,
    ).toBe("mapping");
  });

  test("un SKU de variante vaut « mapped », comme un SKU de produit", async () => {
    const { productMatchStatus } = await import("./resolver-types");
    expect(productMatchStatus("variant_sku")).toBe("mapped");
  });
});

describe("resolveProduct — le SKU de variante, en base", () => {
  function mockClient(opts: {
    variantRow?: { id: string; product_id: string } | null;
    skuRow?: { id: string } | null;
  }) {
    const fromCalls: string[] = [];
    const eqCalls: { table: string; col: string; val: unknown }[] = [];
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
        chain.maybeSingle = vi.fn(async () => {
          if (table === "storefront_product_mappings") return { data: null, error: null };
          if (table === "product_variants") return { data: opts.variantRow ?? null, error: null };
          const usedIlike = (chain.ilike as ReturnType<typeof vi.fn>).mock.calls.length > 0;
          return { data: usedIlike ? null : opts.skuRow ?? null, error: null };
        });
        return chain;
      }),
    };
    return { client, fromCalls, eqCalls };
  }

  test("résout produit + variante depuis le SKU de la variante", async () => {
    const { client, eqCalls } = mockClient({
      variantRow: { id: "var-grand", product_id: "prod-1" },
    });
    const result = await resolveProduct(client as never, {
      storefront_id: "sf-1",
      market_id: "mkt-1",
      external_variant_id: null,
      sku: "DOU-GRAND",
      product_name: "Doudoune",
    });
    expect(result).toEqual({
      product_id: "prod-1",
      product_variant_id: "var-grand",
      match_method: "variant_sku",
    });

    // La recherche est bornée au marché — sans quoi un SKU libyen répondrait à
    // une commande tunisienne.
    const scoped = eqCalls.filter(
      (c) => c.table === "product_variants" && c.col === "market_id",
    );
    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped.every((c) => c.val === "mkt-1")).toBe(true);
  });

  // Un palier ne désigne pas un objet en rayon : le résoudre ferait porter le
  // stock à une ligne qui n'en a pas.
  test("ne cherche que les variantes d'attribut", async () => {
    const { client, eqCalls } = mockClient({ variantRow: null, skuRow: { id: "prod-sku" } });
    await resolveProduct(client as never, {
      storefront_id: "sf-1",
      market_id: "mkt-1",
      external_variant_id: null,
      sku: "DOU-GRAND",
      product_name: "Doudoune",
    });
    expect(eqCalls).toContainEqual({
      table: "product_variants",
      col: "kind",
      val: "attribute",
    });
  });

  test("sans variante correspondante, le SKU produit reprend la main", async () => {
    const { client } = mockClient({ variantRow: null, skuRow: { id: "prod-sku" } });
    const result = await resolveProduct(client as never, {
      storefront_id: "sf-1",
      market_id: "mkt-1",
      external_variant_id: null,
      sku: "DOU",
      product_name: "Doudoune",
    });
    expect(result).toEqual({
      product_id: "prod-sku",
      product_variant_id: null,
      match_method: "sku",
    });
  });

  test("sans SKU du tout, aucune lecture de product_variants", async () => {
    const { client, fromCalls } = mockClient({});
    await resolveProduct(client as never, {
      storefront_id: "sf-1",
      market_id: "mkt-1",
      external_variant_id: null,
      sku: null,
      product_name: "Doudoune",
    });
    expect(fromCalls).not.toContain("product_variants");
  });
});
