import { describe, test, expect, vi, beforeEach } from "vitest";

const mockRpc = vi.fn();
const mockGetActor = vi.fn();
const mockResolveSiteFilter = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

vi.mock("@/lib/auth/actor", () => ({
  getActor: (...args: unknown[]) => mockGetActor(...args),
}));

vi.mock("@/lib/warehouse/site-scope", () => ({
  resolveSiteFilter: (...args: unknown[]) => mockResolveSiteFilter(...args),
}));

import { POST } from "./route";
import { NextRequest } from "next/server";

function req(body: unknown) {
  return new NextRequest(new URL("http://localhost/api/warehouse/stock/count"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActor.mockResolvedValue({
    actor: { id: "wh-1", role: "warehouse_agent", market_id: "m-tn" },
  });
  mockResolveSiteFilter.mockResolvedValue({
    warehouseId: "w-tunis",
    pinned: true,
    unassigned: false,
  });
  mockRpc.mockResolvedValue({ data: { stock_after: 30 }, error: null });
});

const base = { product_id: "p-1", counted_qty: 30, note: "comptage du matin" };

/*
 * Un comptage porte sur une ÉTAGÈRE, et une étagère range des tailles
 * séparément. Sans `variant_id`, compter « 12 Petit » écrasait la ligne du
 * produit entier : le chiffre du bâtiment devenait faux pour toutes les autres
 * tailles d'un coup.
 */
describe("POST /api/warehouse/stock/count — le comptage peut viser une variante", () => {
  test("transmet variant_id à la RPC quand le corps en porte un", async () => {
    const res = await POST(req({ ...base, variant_id: "v-petit" }));

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      "record_stock_count",
      expect.objectContaining({
        p_product_id: "p-1",
        p_counted_qty: 30,
        p_warehouse_id: "w-tunis",
        p_variant_id: "v-petit",
      }),
    );
  });

  // Le paramètre a un défaut NULL en SQL : l'appelant historique doit continuer
  // à marcher sans rien changer, et un comptage sans variante reste un comptage
  // du produit entier sur ce site.
  test("envoie null quand aucune variante n'est nommée", async () => {
    await POST(req(base));

    expect(mockRpc).toHaveBeenCalledWith(
      "record_stock_count",
      expect.objectContaining({ p_variant_id: null }),
    );
  });

  test("une chaîne vide vaut « pas de variante », pas une variante vide", async () => {
    await POST(req({ ...base, variant_id: "   " }));

    expect(mockRpc).toHaveBeenCalledWith(
      "record_stock_count",
      expect.objectContaining({ p_variant_id: null }),
    );
  });

  test("refuse un variant_id qui n'est pas une chaîne", async () => {
    const res = await POST(req({ ...base, variant_id: 42 }));

    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

/*
 * La RPC refuse une variante qui n'appartient pas au produit, ou qui est un
 * palier. C'est un problème de saisie, pas une panne : 422, pas 500.
 */
describe("POST /api/warehouse/stock/count — les refus de la RPC", () => {
  test("une variante étrangère au produit rend 422", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Cette variante n'appartient pas au produit, ou ne porte pas de stock" },
    });

    const res = await POST(req({ ...base, variant_id: "v-autre" }));
    expect(res.status).toBe(422);
  });
});
