import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetActor = vi.fn();
const state = {
  rows: [] as Record<string, unknown>[],
  selectArg: "",
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: () => {
      const c: Record<string, unknown> = {};
      c.select = vi.fn().mockImplementation((cols: string) => {
        state.selectArg = cols;
        return c;
      });
      c.eq = vi.fn().mockReturnValue(c);
      // `order` is chained twice, and the second call resolves.
      let orders = 0;
      c.order = vi.fn().mockImplementation(() => {
        orders += 1;
        return orders >= 2 ? Promise.resolve({ data: state.rows, error: null }) : c;
      });
      return c;
    },
  }),
}));

vi.mock("@/lib/auth/actor", () => ({
  getActor: (...a: unknown[]) => mockGetActor(...a),
}));

vi.mock("@/lib/warehouse/scope", () => ({
  resolveWarehouseScope: () => ({ marketId: null, marketCode: null, currency: "LYD" }),
}));

vi.mock("@/lib/warehouse/site-scope", () => ({
  resolveSiteFilter: vi.fn().mockResolvedValue({
    warehouseId: null,
    pinned: false,
    unassigned: false,
  }),
}));

import { GET } from "./route";
import { NextRequest } from "next/server";

function req() {
  return new NextRequest(new URL("http://localhost/api/warehouse/sites"));
}

beforeEach(() => {
  vi.clearAllMocks();
  state.selectArg = "";
  state.rows = [
    {
      id: "w-tripoli",
      code: "tripoli",
      name_fr: "Tripoli",
      name_ar: "طرابلس",
      is_default: true,
      market_id: "m-ly",
    },
  ];
  mockGetActor.mockResolvedValue({
    actor: { id: "sa-1", role: "super_admin", market_id: null },
  });
});

/**
 * LE BÂTIMENT PORTE SON MARCHÉ.
 *
 * Un super_admin n'a pas de `market_id` — en production les deux en ont un NULL —
 * donc tout écran qui doit nommer un marché pour lui doit le déduire d'autre
 * chose. Le bâtiment est le bon candidat, et c'est déjà la règle du domaine :
 * « le marché vient du bâtiment, jamais du corps de la requête », parce que c'est
 * le bâtiment qui est physique. Sans ce champ, le sélecteur de produits d'une
 * réception renvoyait une liste vide à un super_admin, qui ne pouvait donc ajouter
 * aucune ligne.
 */
describe("GET /api/warehouse/sites — le marché du bâtiment", () => {
  test("expose le market_id de chaque site", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sites[0]).toMatchObject({ id: "w-tripoli", marketId: "m-ly" });
  });

  test("le demande à la base", async () => {
    await GET(req());
    expect(state.selectArg).toContain("market_id");
  });

  test("garde les champs dont dépendent les autres écrans", async () => {
    const body = await (await GET(req())).json();
    expect(body.sites[0]).toMatchObject({ code: "tripoli", name: "Tripoli", isDefault: true });
    expect(body).toMatchObject({ mine: null, pinned: false, unassigned: false });
  });
});
