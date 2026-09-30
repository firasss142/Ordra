import { describe, test, expect, vi, beforeEach } from "vitest";

const mockRpc = vi.fn();
const mockGetActor = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

vi.mock("@/lib/auth/actor", () => ({
  getActor: (...args: unknown[]) => mockGetActor(...args),
}));

import { POST } from "./route";
import { NextRequest } from "next/server";

function req(body?: unknown) {
  return new NextRequest(new URL("http://localhost/api/warehouse/receptions/r-1/post"), {
    method: "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const params = Promise.resolve({ id: "r-1" });

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActor.mockResolvedValue({
    actor: { id: "mm-1", role: "market_manager", market_id: "m-ly" },
  });
  mockRpc.mockResolvedValue({ data: { units: 312, lines: 4 }, error: null });
});

/*
 * Valider est le seul geste qui fait exister le stock. La séparation des tâches
 * n'est pas décorative : recevoir est le seul mouvement qui crée des unités à
 * partir de rien, sans document en face.
 */
describe("POST …/[id]/post — qui peut valider", () => {
  test("un market_manager valide", async () => {
    const res = await POST(req(), { params });
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("post_reception", {
      p_reception_id: "r-1",
      p_actor_id: "mm-1",
      p_adopt_costs: false,
    });
  });

  test("un warehouse_agent est refusé — il déclare, il ne valide pas", async () => {
    mockGetActor.mockResolvedValue({
      actor: { id: "wh-1", role: "warehouse_agent", market_id: "m-ly" },
    });
    const res = await POST(req(), { params });
    expect(res.status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("un agent de confirmation est refusé", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "a-1", role: "agent", market_id: "m-ly" } });
    expect((await POST(req(), { params })).status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

/*
 * LE POINT LE PLUS IMPORTANT DE CE FICHIER. `products.unit_cogs` est lu en
 * direct par un P&L fenêtré sur événements et par les faits investisseurs.
 * L'adopter recalcule la marge de commandes DÉJÀ LIVRÉES. Un client qui oublie
 * le champ ne doit donc pas redater la rentabilité par accident.
 */
describe("POST …/[id]/post — adopter les coûts est explicite", () => {
  test("un corps vide n'adopte rien", async () => {
    await POST(req(), { params });
    expect(mockRpc.mock.calls[0][1].p_adopt_costs).toBe(false);
  });

  test("un corps sans le champ n'adopte rien", async () => {
    await POST(req({}), { params });
    expect(mockRpc.mock.calls[0][1].p_adopt_costs).toBe(false);
  });

  test("seul un true strict adopte", async () => {
    await POST(req({ adopt_costs: true }), { params });
    expect(mockRpc.mock.calls[0][1].p_adopt_costs).toBe(true);
  });

  test("une valeur vaguement vraie n'adopte pas", async () => {
    await POST(req({ adopt_costs: "yes" }), { params });
    expect(mockRpc.mock.calls[0][1].p_adopt_costs).toBe(false);
  });

  test("adopt_costs false n'adopte pas", async () => {
    await POST(req({ adopt_costs: false }), { params });
    expect(mockRpc.mock.calls[0][1].p_adopt_costs).toBe(false);
  });
});

describe("POST …/[id]/post — les codes d'erreur de la RPC deviennent des statuts", () => {
  const cases: [string, number][] = [
    ["ACTOR_MISMATCH", 403],
    ["FORBIDDEN", 403],
    ["MARKET_MISMATCH", 403],
    ["NO_RECEPTION", 404],
    ["ALREADY_POSTED", 409],
    ["EMPTY_RECEPTION", 422],
    ["BAD_LINE", 422],
  ];

  for (const [code, status] of cases) {
    test(`${code} → ${status}`, async () => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message: "refusé", details: `{"code":"${code}"}` },
      });
      const res = await POST(req(), { params });
      expect(res.status).toBe(status);
      expect((await res.json()).error_code).toBe(code);
    });
  }

  test("une erreur sans code reste un 422, pas un 500", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom", details: null } });
    const res = await POST(req(), { params });
    expect(res.status).toBe(422);
    expect((await res.json()).error_code).toBeNull();
  });
});
