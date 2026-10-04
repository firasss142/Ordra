import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetActor = vi.fn();
const state = {
  rpc: null as { name: string; args: Record<string, unknown> } | null,
  rpcError: null as { message: string; details?: string } | null,
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    rpc: vi.fn().mockImplementation((name: string, args: Record<string, unknown>) => {
      state.rpc = { name, args };
      return Promise.resolve(
        state.rpcError
          ? { data: null, error: state.rpcError }
          : { data: { claim_id: "c-1", status: "credited", amount: 170 }, error: null },
      );
    }),
  }),
}));

vi.mock("@/lib/auth/actor", () => ({ getActor: (...a: unknown[]) => mockGetActor(...a) }));

import { POST } from "./route";
import { NextRequest } from "next/server";

const params = Promise.resolve({ id: "c-1" });
function post(body: unknown) {
  return new NextRequest(new URL("http://localhost/api/purchases/claims/c-1/resolve"), {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.rpc = null;
  state.rpcError = null;
  mockGetActor.mockResolvedValue({
    actor: { id: "m-1", role: "market_manager", market_id: "m-ly" },
  });
});

describe("POST …/claims/[id]/resolve", () => {
  test("enregistre l'avoir reçu avec sa référence", async () => {
    const res = await POST(post({ outcome: "credited", credit_ref: "AV-4471" }), { params });
    expect(res.status).toBe(200);
    expect(state.rpc?.name).toBe("resolve_supplier_claim");
    expect(state.rpc?.args).toMatchObject({
      p_claim_id: "c-1",
      p_actor_id: "m-1",
      p_outcome: "credited",
      p_credit_ref: "AV-4471",
    });
  });

  test("enregistre qu'on renonce", async () => {
    await POST(post({ outcome: "conceded", note: "trop petit pour se battre" }), { params });
    expect(state.rpc?.args).toMatchObject({
      p_outcome: "conceded",
      p_note: "trop petit pour se battre",
    });
  });

  /*
   * UN AVOIR SE PROUVE. Dire « le fournisseur a crédité » sans pouvoir nommer la
   * pièce, c'est effacer une créance sur une parole — et c'est précisément
   * l'écriture qu'un audit demandera à voir. La base le refuse aussi ; la route
   * ne s'appuie jamais sur la base pour dire non.
   */
  test("refuse un avoir sans référence, sans appeler la base", async () => {
    const res = await POST(post({ outcome: "credited" }), { params });
    expect(res.status).toBe(400);
    expect(state.rpc).toBeNull();
  });

  test("refuse une issue inventée", async () => {
    const res = await POST(post({ outcome: "ignored" }), { params });
    expect(res.status).toBe(400);
    expect(state.rpc).toBeNull();
  });

  test("refuse le quai — un litige est de l'argent", async () => {
    mockGetActor.mockResolvedValue({
      actor: { id: "a-1", role: "warehouse_agent", market_id: "m-ly" },
    });
    expect((await POST(post({ outcome: "conceded" }), { params })).status).toBe(403);
    expect(state.rpc).toBeNull();
  });

  test("répond 409 sur un litige déjà résolu", async () => {
    state.rpcError = { message: "déjà credited", details: '{"code":"ALREADY_RESOLVED"}' };
    expect((await POST(post({ outcome: "conceded" }), { params })).status).toBe(409);
  });

  test("répond 404 sur un litige introuvable", async () => {
    state.rpcError = { message: "introuvable", details: '{"code":"NOT_FOUND"}' };
    expect((await POST(post({ outcome: "conceded" }), { params })).status).toBe(404);
  });
});
