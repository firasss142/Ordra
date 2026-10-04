import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetActor = vi.fn();
const state = {
  lineCount: 0,
  deleted: false,
  deleteError: null as { message: string; code?: string } | null,
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (table: string) => {
      if (table === "reception_lines") {
        // `head: true` + `count` : la route ne lit pas les lignes, elle les COMPTE.
        const chain: Record<string, unknown> = {
          then: (res: (v: unknown) => unknown) =>
            Promise.resolve({ count: state.lineCount, error: null }).then(res),
        };
        for (const m of ["select", "eq"]) chain[m] = vi.fn().mockReturnValue(chain);
        return chain;
      }
      const chain: Record<string, unknown> = {
        then: (res: (v: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(res),
      };
      for (const m of ["select", "eq", "maybeSingle"]) chain[m] = vi.fn().mockReturnValue(chain);
      chain.delete = vi.fn().mockImplementation(() => {
        state.deleted = true;
        return {
          eq: () => Promise.resolve({ error: state.deleteError }),
        };
      });
      return chain;
    },
  }),
}));

vi.mock("@/lib/auth/actor", () => ({ getActor: (...a: unknown[]) => mockGetActor(...a) }));

import { DELETE } from "./route";
import { NextRequest } from "next/server";

const params = Promise.resolve({ id: "r-1" });
function req() {
  return new NextRequest(new URL("http://localhost/api/warehouse/receptions/r-1"), {
    method: "DELETE",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.lineCount = 0;
  state.deleted = false;
  state.deleteError = null;
  mockGetActor.mockResolvedValue({
    actor: { id: "m-1", role: "market_manager", market_id: "m-ly" },
  });
});

/**
 * UN ARRIVAGE NE SE DÉ-ARRIVE PAS EN SUPPRIMANT LE DOCUMENT.
 *
 * Depuis la bascule du quai, les unités d'un groupe OUVERT sont DÉJÀ dans
 * `products.current_stock` — le stock entre quand le carton touche le sol.
 * Supprimer le document laisserait donc le stock en place sans rien qui
 * l'explique, et les lignes de registre `arrival` pointeraient sur une
 * réception qui n'existe plus.
 *
 * La bonne réponse est `correct_arrival(ligne, 0)`, qui écrit le DELTA au
 * registre. Le groupe VIDE, lui, n'est qu'un contenant : il se supprime.
 */
describe("DELETE /api/warehouse/receptions/[id]", () => {
  test("supprime un groupe vide — ce n'est qu'un contenant", async () => {
    const res = await DELETE(req(), { params });
    expect(res.status).toBe(200);
    expect(state.deleted).toBe(true);
  });

  test("refuse de supprimer un groupe qui a compté quelque chose", async () => {
    state.lineCount = 2;
    const res = await DELETE(req(), { params });
    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe("ARRIVALS_RECORDED");
    // Et surtout : rien n'est parti à la base.
    expect(state.deleted).toBe(false);
  });

  test("refuse un rôle qui ne supprime pas", async () => {
    mockGetActor.mockResolvedValue({
      actor: { id: "a-1", role: "warehouse_agent", market_id: "m-ly" },
    });
    expect((await DELETE(req(), { params })).status).toBe(403);
    expect(state.deleted).toBe(false);
  });

  test("traduit le refus du déclencheur d'immuabilité en 409", async () => {
    state.deleteError = { message: "Une réception soldée est définitive", code: "42501" };
    expect((await DELETE(req(), { params })).status).toBe(409);
  });
});
