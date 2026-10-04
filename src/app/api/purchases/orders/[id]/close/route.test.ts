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
          : { data: { purchase_order_id: "po-1", status: "closed" }, error: null },
      );
    }),
  }),
}));

vi.mock("@/lib/auth/actor", () => ({ getActor: (...a: unknown[]) => mockGetActor(...a) }));

import { POST } from "./route";
import { NextRequest } from "next/server";

function post(body: unknown = {}) {
  return new NextRequest(new URL("http://localhost/api/purchases/orders/po-1/close"), {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}
const params = Promise.resolve({ id: "po-1" });

beforeEach(() => {
  vi.clearAllMocks();
  state.rpc = null;
  state.rpcError = null;
  mockGetActor.mockResolvedValue({
    actor: { id: "m-1", role: "market_manager", market_id: "m-ly" },
  });
});

describe("POST …/[id]/close", () => {
  test("arrête d'attendre le reste", async () => {
    const res = await POST(post({ reason: "le fournisseur est en rupture" }), { params });
    expect(res.status).toBe(200);
    expect(state.rpc?.name).toBe("close_purchase_order");
    expect(state.rpc?.args).toMatchObject({
      p_purchase_order_id: "po-1",
      p_actor_id: "m-1",
      p_reason: "le fournisseur est en rupture",
    });
  });

  test("accepte de clôturer sans motif", async () => {
    // Un motif obligatoire ferait écrire « . » — on préfère `null`, qui dit
    // honnêtement que personne n'a expliqué.
    await POST(post({}), { params });
    expect(state.rpc?.args.p_reason).toBeNull();
  });

  test("refuse le quai", async () => {
    mockGetActor.mockResolvedValue({
      actor: { id: "a-1", role: "warehouse_agent", market_id: "m-ly" },
    });
    expect((await POST(post(), { params })).status).toBe(403);
    expect(state.rpc).toBeNull();
  });

  test("répond 409 sur une commande déjà clôturée", async () => {
    state.rpcError = { message: "plus ouverte", details: '{"code":"ALREADY_CLOSED"}' };
    expect((await POST(post(), { params })).status).toBe(409);
  });

  test("répond 404 sur une commande introuvable", async () => {
    state.rpcError = { message: "introuvable", details: '{"code":"NOT_FOUND"}' };
    expect((await POST(post(), { params })).status).toBe(404);
  });
});
