import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

import { PATCH, DELETE } from "./route";
import { NextRequest } from "next/server";

function chain(result: { data: unknown; error?: unknown; count?: number | null }) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "ilike", "neq", "limit", "update", "delete", "or", "in"]) {
    c[m] = vi.fn(() => c);
  }
  c.single = vi.fn().mockResolvedValue({ data: result.data, error: result.error ?? null });
  c.maybeSingle = vi.fn().mockResolvedValue({ data: result.data, error: result.error ?? null });
  c.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({
      data: result.data,
      error: result.error ?? null,
      count: result.count ?? null,
    }).then(resolve);
  return c;
}

const params = { params: Promise.resolve({ id: "p-1", variantId: "v-1" }) };

function patchReq(body: unknown) {
  return new NextRequest(new URL("http://localhost/api/products/p-1/variants/v-1"), {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}
function deleteReq() {
  return new NextRequest(new URL("http://localhost/api/products/p-1/variants/v-1"), {
    method: "DELETE",
  });
}

/** super_admin + product lookup + the variant row itself. */
function wire(variant: Record<string, unknown> | null = {
  id: "v-1",
  product_id: "p-1",
  kind: "attribute",
  current_stock: 0,
  damaged_return_count: 0,
}) {
  mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
  return mockFrom
    .mockReturnValueOnce(chain({ data: { role: "super_admin", market_id: null } }))
    .mockReturnValueOnce(chain({ data: { market_id: "m-tn" } }))
    .mockReturnValueOnce(chain({ data: variant, error: variant ? null : { code: "PGRST116" } }));
}

beforeEach(() => {
  mockGetUser.mockReset();
  mockFrom.mockReset();
});

describe("PATCH — le coût et le SKU d'une variante sont modifiables", () => {
  test("accepte sku et unit_cogs", async () => {
    wire().mockReturnValueOnce(chain({ data: { id: "v-1" } }));

    const res = await PATCH(patchReq({ sku: "DOU-G2", unit_cogs: 24 }), params);

    expect(res.status).toBe(200);
    const updates = (mockFrom.mock.results[3].value.update as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as Record<string, unknown>;
    expect(updates.sku).toBe("DOU-G2");
    expect(updates.unit_cogs).toBe(24);
  });

  test("une chaîne SKU vide efface le SKU", async () => {
    wire().mockReturnValueOnce(chain({ data: { id: "v-1" } }));
    await PATCH(patchReq({ sku: "  " }), params);
    const updates = (mockFrom.mock.results[3].value.update as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as Record<string, unknown>;
    expect(updates.sku).toBeNull();
  });

  /*
   * Le stock ne s'écrit pas ici. Il a cinq chemins, tous passant par le
   * registre ; un sixième par un formulaire d'édition laisserait un solde sans
   * ligne pour l'expliquer, et le registre est en écriture seule.
   */
  test("current_stock dans le corps est ignoré", async () => {
    wire().mockReturnValueOnce(chain({ data: { id: "v-1" } }));
    const res = await PATCH(patchReq({ current_stock: 999, unit_cogs: 5 }), params);
    expect(res.status).toBe(200);
    const updates = (mockFrom.mock.results[3].value.update as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as Record<string, unknown>;
    expect(updates.current_stock).toBeUndefined();
  });

  test("current_stock seul ne constitue pas une modification", async () => {
    wire();
    const res = await PATCH(patchReq({ current_stock: 999 }), params);
    expect(res.status).toBe(400);
  });

  // Changer d'axe redéfinit ce que la ligne EST. Tant qu'elle porte du stock,
  // le faire laisserait des unités attribuées à une ligne qui n'en porte plus.
  test("changer kind est refusé quand la variante porte du stock", async () => {
    wire({ id: "v-1", product_id: "p-1", kind: "attribute", current_stock: 7, damaged_return_count: 0 });
    const res = await PATCH(patchReq({ kind: "pack" }), params);
    expect(res.status).toBe(409);
  });

  test("changer kind est permis à stock nul", async () => {
    wire().mockReturnValueOnce(chain({ data: { id: "v-1" } }));
    const res = await PATCH(patchReq({ kind: "pack", quantity: 2 }), params);
    expect(res.status).toBe(200);
  });

  test("un SKU déjà pris rend 409", async () => {
    wire().mockReturnValueOnce(chain({ data: null, error: { code: "23505" } }));
    const res = await PATCH(patchReq({ sku: "PRIS" }), params);
    expect(res.status).toBe(409);
  });
});

/*
 * SUPPRIMER UNE VARIANTE — la route n'existait pas du tout.
 *
 * On suit le précédent des motifs de rejet (docs/rejection-reasons.md) :
 * suppression franche quand rien ne s'y réfère, retrait en douceur sinon,
 * parce que l'historique doit rester lisible. Une commande passée sur « Grand »
 * doit continuer à dire « Grand » des mois après que la taille a quitté le
 * catalogue.
 */
describe("DELETE — franche si libre, en douceur si l'histoire s'y réfère", () => {
  test("supprime vraiment quand rien ne référence la variante", async () => {
    wire()
      .mockReturnValueOnce(chain({ data: [], count: 0 })) // order_items
      .mockReturnValueOnce(chain({ data: [], count: 0 })) // orders
      .mockReturnValueOnce(chain({ data: [], count: 0 })) // inventory_log
      .mockReturnValueOnce(chain({ data: [], count: 0 })) // storefront mappings
      .mockReturnValueOnce(chain({ data: null })); // delete

    const res = await DELETE(deleteReq(), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true, retired: false });
  });

  test("retire en douceur quand une commande s'y réfère", async () => {
    wire()
      .mockReturnValueOnce(chain({ data: [{ id: "oi-1" }], count: 1 }))
      .mockReturnValueOnce(chain({ data: null })); // update is_active = false

    const res = await DELETE(deleteReq(), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: false, retired: true });

    const updates = (mockFrom.mock.results[4].value.update as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as Record<string, unknown>;
    expect(updates.is_active).toBe(false);
  });

  /*
   * Une variante qui porte encore des unités ne se supprime pas en silence :
   * ces unités resteraient dans le total marché sans plus rien pour dire de
   * quelle taille elles sont. On demande de les solder d'abord.
   */
  test("refuse tant que la variante porte du stock", async () => {
    wire({ id: "v-1", product_id: "p-1", kind: "attribute", current_stock: 12, damaged_return_count: 0 });
    const res = await DELETE(deleteReq(), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/stock/i);
  });

  test("404 quand la variante n'est pas celle de ce produit", async () => {
    wire(null);
    const res = await DELETE(deleteReq(), params);
    expect(res.status).toBe(404);
  });

  test("un market_manager ne peut pas supprimer", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    mockFrom
      .mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: "m-tn" } }))
      .mockReturnValueOnce(chain({ data: { market_id: "m-tn" } }));
    const res = await DELETE(deleteReq(), params);
    expect(res.status).toBe(403);
  });
});
