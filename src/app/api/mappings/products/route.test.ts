import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

import { GET, POST } from "./route";
import { NextRequest } from "next/server";

// A chainable query mock. Every builder method returns the chain; the chain is
// also awaitable (thenable) and resolves to { data, error } for list queries.
function chain(result: { data: unknown; error?: unknown }) {
  const c: Record<string, unknown> = {};
  const methods = ["select", "eq", "in", "is", "neq", "order", "update", "insert"];
  for (const m of methods) c[m] = vi.fn(() => c);
  c.single = vi.fn().mockResolvedValue({ data: result.data, error: result.error ?? null });
  c.maybeSingle = vi.fn().mockResolvedValue({ data: result.data, error: result.error ?? null });
  c.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: result.data, error: result.error ?? null }).then(resolve);
  return c;
}

function getReq(url = "http://localhost/api/mappings/products") {
  return new NextRequest(new URL(url), { method: "GET" });
}
function postReq(body: unknown) {
  return new NextRequest(new URL("http://localhost/api/mappings/products"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockGetUser.mockReset();
  mockFrom.mockReset();
});

describe("GET /api/mappings/products", () => {
  test("agent is forbidden", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "a-1" } } });
    mockFrom.mockReturnValueOnce(chain({ data: { role: "agent", market_id: "m-tn" } }));
    const res = await GET(getReq());
    expect(res.status).toBe(403);
  });

  test("market_manager mappings are scoped to their market's storefronts", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    // 1) users lookup, 2) storefronts (market-scoped), 3) storefront_product_mappings
    mockFrom
      .mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: "m-tn" } }))
      .mockReturnValueOnce(chain({ data: [{ id: "sf-tn", name: "TN Store", market_id: "m-tn" }] }))
      .mockReturnValueOnce(
        chain({ data: [{ id: "map-1", storefront_id: "sf-tn", product_id: "p-1" }] }),
      );
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
    // storefronts query was market-scoped
    const sfChain = mockFrom.mock.results[1].value;
    expect(sfChain.eq).toHaveBeenCalledWith("market_id", "m-tn");
  });

  test("returns empty list when the market has no storefronts", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    mockFrom
      .mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: "m-tn" } }))
      .mockReturnValueOnce(chain({ data: [] }));
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([]);
  });
});

describe("POST /api/mappings/products", () => {
  test("agent is forbidden", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "a-1" } } });
    mockFrom.mockReturnValueOnce(chain({ data: { role: "agent", market_id: "m-tn" } }));
    const res = await POST(postReq({ storefront_id: "sf", external_variant_id: "v", product_id: "p" }));
    expect(res.status).toBe(403);
  });

  test("rejects missing required fields", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    mockFrom.mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: "m-tn" } }));
    const res = await POST(postReq({ storefront_id: "sf-1" }));
    expect(res.status).toBe(400);
  });

  test("rejects cross-market product/storefront pairing", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    mockFrom
      .mockReturnValueOnce(chain({ data: { role: "super_admin", market_id: null } }))
      // Promise.all: storefronts then products
      .mockReturnValueOnce(chain({ data: { id: "sf-1", market_id: "m-tn" } }))
      .mockReturnValueOnce(chain({ data: { id: "p-1", market_id: "m-ly" } }));
    const res = await POST(
      postReq({ storefront_id: "sf-1", external_variant_id: "v-1", product_id: "p-1" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/different markets/i);
  });

  test("creates the mapping and back-fills open orders, promoting only city-resolved ones", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    mockFrom
      .mockReturnValueOnce(chain({ data: { role: "super_admin", market_id: null } }))
      .mockReturnValueOnce(chain({ data: { id: "sf-1", market_id: "m-tn" } })) // storefront
      .mockReturnValueOnce(chain({ data: { id: "p-1", market_id: "m-tn" } })) // product
      .mockReturnValueOnce(chain({ data: { id: "map-1" } })) // insert mapping
      .mockReturnValueOnce(
        // open orders carrying this variant
        chain({
          data: [
            { id: "o-city-ok", city_id: "city-1" },
            { id: "o-city-null", city_id: null },
          ],
        }),
      )
      .mockReturnValueOnce(chain({ data: null })) // update o-city-ok
      .mockReturnValueOnce(chain({ data: null })); // update o-city-null

    const res = await POST(
      postReq({ storefront_id: "sf-1", external_variant_id: "v-1", product_id: "p-1" }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.backfilled).toBe(2);

    // o-city-ok -> mapped; o-city-null -> needs_review
    const updateCityOk = mockFrom.mock.results[5].value;
    expect(updateCityOk.update).toHaveBeenCalledWith(
      expect.objectContaining({ product_id: "p-1", mapping_status: "mapped" }),
    );
    const updateCityNull = mockFrom.mock.results[6].value;
    expect(updateCityNull.update).toHaveBeenCalledWith(
      expect.objectContaining({ product_id: "p-1", mapping_status: "needs_review" }),
    );
  });

  test("returns 409 on duplicate mapping", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    mockFrom
      .mockReturnValueOnce(chain({ data: { role: "super_admin", market_id: null } }))
      .mockReturnValueOnce(chain({ data: { id: "sf-1", market_id: "m-tn" } }))
      .mockReturnValueOnce(chain({ data: { id: "p-1", market_id: "m-tn" } }))
      .mockReturnValueOnce(chain({ data: null, error: { code: "23505" } }));
    const res = await POST(
      postReq({ storefront_id: "sf-1", external_variant_id: "v-1", product_id: "p-1" }),
    );
    expect(res.status).toBe(409);
  });
});

/*
 * LIER UNE VARIANTE EXTERNE À UNE VARIANTE ORDRA.
 *
 * `product_variant_id` était accepté et écrit sans jamais être vérifié : rien
 * n'empêchait de lier la variante d'un AUTRE produit. La commande serait alors
 * arrivée avec un couple (produit A, variante de B) — que `order_stock_lines`
 * ramène silencieusement au produit, donc le stock aurait bougé au mauvais
 * grain sans qu'aucun écran ne le dise. On refuse à la liaison, là où quelqu'un
 * peut encore corriger.
 */
describe("POST /api/mappings/products — la variante doit appartenir au produit", () => {
  function wireActor() {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    return mockFrom
      .mockReturnValueOnce(chain({ data: { role: "super_admin", market_id: null } }))
      .mockReturnValueOnce(chain({ data: { id: "sf-1", market_id: "m-tn" } }))
      .mockReturnValueOnce(chain({ data: { id: "p-1", market_id: "m-tn" } }));
  }

  test("refuse une variante qui appartient à un autre produit", async () => {
    wireActor().mockReturnValueOnce(chain({ data: null })); // lookup finds nothing
    const res = await POST(
      postReq({
        storefront_id: "sf-1",
        external_variant_id: "v-1",
        product_id: "p-1",
        product_variant_id: "var-autre",
      }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/variante/i);
  });

  test("accepte une variante du bon produit", async () => {
    wireActor()
      .mockReturnValueOnce(chain({ data: { id: "var-1", product_id: "p-1" } }))
      .mockReturnValueOnce(chain({ data: { id: "map-1" } }))
      .mockReturnValueOnce(chain({ data: [] }));
    const res = await POST(
      postReq({
        storefront_id: "sf-1",
        external_variant_id: "v-1",
        product_id: "p-1",
        product_variant_id: "var-1",
      }),
    );
    expect(res.status).toBe(201);
  });

  // Sans variante nommée, rien ne change : la liaison reste au produit et
  // aucune lecture supplémentaire n'est faite.
  test("sans variante, aucune vérification supplémentaire", async () => {
    wireActor()
      .mockReturnValueOnce(chain({ data: { id: "map-1" } }))
      .mockReturnValueOnce(chain({ data: [] }));
    const res = await POST(
      postReq({ storefront_id: "sf-1", external_variant_id: "v-1", product_id: "p-1" }),
    );
    expect(res.status).toBe(201);
    expect(mockFrom).not.toHaveBeenCalledWith("product_variants");
  });
});
