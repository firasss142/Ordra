import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetActor = vi.fn();
const state = {
  status: "draft" as string | null,
  inserted: null as Record<string, unknown> | null,
  updated: null as Record<string, unknown> | null,
  deletedId: null as string | null,
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (table: string) => {
      if (table === "receptions") {
        const chain: Record<string, unknown> = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: () =>
            Promise.resolve({
              data: state.status === null ? null : { id: "r-1", status: state.status },
              error: null,
            }),
          update: vi.fn().mockImplementation((row: Record<string, unknown>) => {
            state.updated = row;
            return { eq: () => Promise.resolve({ error: null }) };
          }),
        };
        chain.select = vi.fn().mockReturnValue(chain);
        chain.eq = vi.fn().mockReturnValue(chain);
        return chain;
      }
      // reception_costs
      return {
        insert: (row: Record<string, unknown>) => {
          state.inserted = row;
          return {
            select: () => ({
              single: () => Promise.resolve({ data: { id: "c-1", ...row }, error: null }),
            }),
          };
        },
        delete: () => ({
          eq: (_c: string, v: string) => {
            state.deletedId = v;
            return { eq: () => Promise.resolve({ error: null }) };
          },
        }),
      };
    },
  }),
}));

vi.mock("@/lib/auth/actor", () => ({ getActor: (...a: unknown[]) => mockGetActor(...a) }));

import { POST, PATCH, DELETE } from "./route";
import { NextRequest } from "next/server";

const params = Promise.resolve({ id: "r-1" });
function body(b: unknown, method = "POST") {
  return new NextRequest(new URL("http://localhost/api/warehouse/receptions/r-1/costs"), {
    method,
    body: JSON.stringify(b),
    headers: { "content-type": "application/json" },
  });
}
function del(qs: string) {
  return new NextRequest(
    new URL(`http://localhost/api/warehouse/receptions/r-1/costs${qs}`),
    { method: "DELETE" },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  state.status = "draft";
  state.inserted = null;
  state.updated = null;
  state.deletedId = null;
  mockGetActor.mockResolvedValue({
    actor: { id: "mm-1", role: "market_manager", market_id: "m-ly" },
  });
});

/**
 * UN FRAIS EST UNE INFORMATION D'ARGENT. Même porte que les paiements : l'agent
 * d'entrepôt compte des objets, ce qu'ils ont coûté ne l'aide pas à compter.
 */
describe("POST …/costs — qui entre", () => {
  test("un manager saisit un frais", async () => {
    const res = await POST(body({ amount: 900, kind: "freight", label: "Misrata → Tripoli" }), { params });
    expect(res.status).toBe(201);
    expect(state.inserted).toMatchObject({
      reception_id: "r-1",
      kind: "freight",
      label: "Misrata → Tripoli",
      amount: 900,
      created_by: "mm-1",
    });
  });

  test("un agent d'entrepôt est refusé", async () => {
    mockGetActor.mockResolvedValue({
      actor: { id: "wh-1", role: "warehouse_agent", market_id: "m-ly" },
    });
    expect((await POST(body({ amount: 900 }), { params })).status).toBe(403);
    expect(state.inserted).toBeNull();
  });
});

describe("POST …/costs — ce qu'on refuse", () => {
  test("un montant nul ou négatif", async () => {
    expect((await POST(body({ amount: 0 }), { params })).status).toBe(400);
    expect((await POST(body({ amount: -5 }), { params })).status).toBe(400);
    expect(state.inserted).toBeNull();
  });

  test("une nature de frais inventée", async () => {
    expect((await POST(body({ amount: 10, kind: "pourboire" }), { params })).status).toBe(400);
    expect(state.inserted).toBeNull();
  });

  /*
   * UNE RÉCEPTION VALIDÉE NE CHANGE PLUS DE FRAIS. Le coût de revient est figé
   * dans `landed_unit_cost` et a pu nourrir `unit_cogs` : rouvrir les frais
   * après coup ferait mentir le registre.
   */
  test("une réception déjà validée", async () => {
    state.status = "posted";
    const res = await POST(body({ amount: 900 }), { params });
    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe("ALREADY_POSTED");
    expect(state.inserted).toBeNull();
  });

  test("une réception contre-passée", async () => {
    state.status = "reversed";
    expect((await POST(body({ amount: 900 }), { params })).status).toBe(409);
  });

  test("une réception qui n'existe pas", async () => {
    state.status = null;
    expect((await POST(body({ amount: 900 }), { params })).status).toBe(404);
  });
});

describe("PATCH …/costs — le critère de répartition", () => {
  test("passe à « par unité »", async () => {
    const res = await PATCH(body({ fee_basis: "units" }, "PATCH"), { params });
    expect(res.status).toBe(200);
    expect(state.updated).toMatchObject({ fee_basis: "units" });
  });

  test("refuse un critère inventé — pas de repli silencieux", async () => {
    expect((await PATCH(body({ fee_basis: "au feeling" }, "PATCH"), { params })).status).toBe(400);
    expect(state.updated).toBeNull();
  });

  test("refuse sur une réception validée", async () => {
    state.status = "posted";
    expect((await PATCH(body({ fee_basis: "units" }, "PATCH"), { params })).status).toBe(409);
    expect(state.updated).toBeNull();
  });
});

describe("DELETE …/costs", () => {
  test("retire un frais saisi par erreur", async () => {
    const res = await DELETE(del("?cost_id=c-9"), { params });
    expect(res.status).toBe(200);
    expect(state.deletedId).toBe("c-9");
  });

  test("exige l'identifiant du frais", async () => {
    expect((await DELETE(del(""), { params })).status).toBe(400);
  });
});
