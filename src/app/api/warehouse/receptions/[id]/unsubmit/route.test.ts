import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetActor = vi.fn();
const state = {
  reception: null as { id: string; status: string; warehouse_id: string } | null,
  loadError: null as { message: string } | null,
  updateError: null as { message: string } | null,
  updates: [] as Record<string, unknown>[],
  updateFilters: [] as Record<string, unknown>[],
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: () => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = self;
      chain.eq = (col: string, val: unknown) => {
        // Les `eq` d'un UPDATE sont la garde contre deux clics simultanés.
        if (chain.__updating) state.updateFilters.push({ [col]: val });
        return chain;
      };
      chain.maybeSingle = async () => ({ data: state.reception, error: state.loadError });
      chain.update = (patch: Record<string, unknown>) => {
        chain.__updating = true;
        state.updates.push(patch);
        return {
          eq: (col: string, val: unknown) => {
            state.updateFilters.push({ [col]: val });
            return {
              eq: (c2: string, v2: unknown) => {
                state.updateFilters.push({ [c2]: v2 });
                return Promise.resolve({ error: state.updateError });
              },
              then: (r: (v: unknown) => unknown) => r({ error: state.updateError }),
            };
          },
        };
      };
      return chain;
    },
  }),
}));

vi.mock("@/lib/auth/actor", () => ({
  getActor: (...args: unknown[]) => mockGetActor(...args),
}));

vi.mock("@/lib/warehouse/site-scope", () => ({
  resolveSiteFilter: vi.fn().mockResolvedValue({
    warehouseId: null,
    pinned: false,
    unassigned: false,
  }),
}));

import { POST } from "./route";
import { NextRequest } from "next/server";

function req() {
  return new NextRequest(new URL("http://localhost/api/warehouse/receptions/r-1/unsubmit"), {
    method: "POST",
  });
}

const params = Promise.resolve({ id: "r-1" });

beforeEach(() => {
  vi.clearAllMocks();
  state.reception = { id: "r-1", status: "submitted", warehouse_id: "w-1" };
  state.loadError = null;
  state.updateError = null;
  state.updates = [];
  state.updateFilters = [];
  mockGetActor.mockResolvedValue({
    actor: { id: "mm-1", role: "market_manager", market_id: "m-ly" },
  });
});

/*
 * Renvoyer à l'agent est le geste de celui qui VALIDE. Sans lui, un manager qui
 * voit une erreur dans une déclaration n'a que deux issues : valider ce qui est
 * faux, ou ne rien faire. Rien n'a bougé en stock à ce stade, donc il n'y a rien
 * à annuler — la réception redevient un brouillon, et c'est tout.
 */
describe("POST …/[id]/unsubmit — qui peut renvoyer", () => {
  test("un market_manager renvoie", async () => {
    const res = await POST(req(), { params });
    expect(res.status).toBe(200);
    expect(state.updates[0]).toMatchObject({ status: "draft" });
  });

  test("un super_admin renvoie", async () => {
    mockGetActor.mockResolvedValue({
      actor: { id: "sa-1", role: "super_admin", market_id: null },
    });
    expect((await POST(req(), { params })).status).toBe(200);
  });

  /*
   * L'agent déclare ; c'est précisément ce qu'il ne doit pas pouvoir défaire
   * tout seul, sinon la séparation des tâches ne tient plus : il déclarerait,
   * rouvrirait, redéclarerait sans qu'aucun manager ne voie passer la version
   * qu'il a corrigée.
   */
  test("un warehouse_agent est refusé", async () => {
    mockGetActor.mockResolvedValue({
      actor: { id: "wh-1", role: "warehouse_agent", market_id: "m-ly" },
    });
    const res = await POST(req(), { params });
    expect(res.status).toBe(403);
    expect(state.updates).toHaveLength(0);
  });

  test("un agent de confirmation est refusé", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "a-1", role: "agent", market_id: "m-ly" } });
    expect((await POST(req(), { params })).status).toBe(403);
  });
});

describe("POST …/[id]/unsubmit — ce qui se renvoie", () => {
  test("une réception validée ne se renvoie pas — elle se contre-passe", async () => {
    state.reception = { id: "r-1", status: "posted", warehouse_id: "w-1" };
    const res = await POST(req(), { params });
    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe("NOT_SUBMITTED");
    expect(state.updates).toHaveLength(0);
  });

  test("un brouillon ne se renvoie pas — il n'a jamais été déclaré", async () => {
    state.reception = { id: "r-1", status: "draft", warehouse_id: "w-1" };
    const res = await POST(req(), { params });
    expect(res.status).toBe(409);
    expect(state.updates).toHaveLength(0);
  });

  test("une réception inconnue est un 404", async () => {
    state.reception = null;
    expect((await POST(req(), { params })).status).toBe(404);
  });

  /*
   * La trace de la déclaration est EFFACÉE en même temps que le statut. La
   * garder laisserait « déclarée par Adel » sur un brouillon que personne n'a
   * déclaré, et c'est ce libellé que le manager lit pour savoir qui a compté.
   */
  test("efface la trace de déclaration en même temps que le statut", async () => {
    await POST(req(), { params });
    expect(state.updates[0]).toEqual({
      status: "draft",
      submitted_at: null,
      submitted_by: null,
    });
  });

  /* Deux clics simultanés ne doivent pas rouvrir une réception déjà validée. */
  test("ne renvoie que ce qui est encore déclaré", async () => {
    await POST(req(), { params });
    expect(state.updateFilters).toEqual(
      expect.arrayContaining([{ id: "r-1" }, { status: "submitted" }]),
    );
  });
});
