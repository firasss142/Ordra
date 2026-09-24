import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

import { POST } from "./route";
import { NextRequest } from "next/server";

function singleChain(data: unknown, error: unknown = null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data, error });
  return c;
}

function postReq(body: unknown) {
  return new NextRequest(new URL("http://localhost/api/products/p-1/stock"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: "p-1" }) };

beforeEach(() => vi.clearAllMocks());

describe("POST /api/products/[id]/stock — stock integrity lockdown", () => {
  test("rejects market_manager with 403 (only super_admin adjusts stock)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    mockFrom
      .mockReturnValueOnce(singleChain({ role: "market_manager", market_id: "m-tn" }))
      .mockReturnValueOnce(
        singleChain({ market_id: "m-tn", current_stock: 10, damaged_return_count: 0 }),
      );
    const res = await POST(
      postReq({ change: 5, reason: "manual_adjustment", note: "restock" }),
      params,
    );
    expect(res.status).toBe(403);
  });

  test("rejects warehouse_agent with 403", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    mockFrom
      .mockReturnValueOnce(singleChain({ role: "warehouse_agent", market_id: "m-tn" }))
      .mockReturnValueOnce(
        singleChain({ market_id: "m-tn", current_stock: 10, damaged_return_count: 0 }),
      );
    const res = await POST(
      postReq({ change: -1, reason: "damaged_writeoff", note: "broken" }),
      params,
    );
    expect(res.status).toBe(403);
  });

  test("allows super_admin and calls adjust_product_stock RPC", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    mockFrom
      .mockReturnValueOnce(singleChain({ role: "super_admin", market_id: null }))
      .mockReturnValueOnce(
        singleChain({ market_id: "m-tn", current_stock: 10, damaged_return_count: 0 }),
      );
    mockRpc.mockResolvedValue({ data: [{ new_stock: 15, new_damaged: 0 }], error: null });
    const res = await POST(
      postReq({ change: 5, reason: "manual_adjustment", note: "restock" }),
      params,
    );
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      "adjust_product_stock",
      expect.objectContaining({
        p_product_id: "p-1",
        p_change: 5,
        p_reason: "manual_adjustment",
        p_actor_id: "sa-1",
        p_is_damaged_writeoff: false,
      }),
    );
  });
});

// `adjust_product_stock` RETURNS TABLE(new_stock INTEGER, new_damaged INTEGER)
// — two columns, and no id. The route nonetheless answered with
// `log_entry: { id: row.log_id }`, reading a column that does not exist, so
// every caller was handed `log_entry: {}`. The response may only carry what
// the RPC actually returns.
describe("POST /api/products/[id]/stock — the response mirrors the RPC contract", () => {
  async function adjust(rpcRow: Record<string, unknown>) {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    mockFrom
      .mockReturnValueOnce(singleChain({ role: "super_admin", market_id: null }))
      .mockReturnValueOnce(
        singleChain({ market_id: "m-tn", current_stock: 10, damaged_return_count: 0 }),
      );
    mockRpc.mockResolvedValue({ data: [rpcRow], error: null });
    const res = await POST(
      postReq({ change: -2, reason: "damaged_writeoff", note: "cassé" }),
      params,
    );
    return { res, body: (await res.json()) as Record<string, unknown> };
  }

  test("does not claim a log entry the RPC never returned", async () => {
    const { body } = await adjust({ new_stock: 10, new_damaged: 2 });
    expect(body).not.toHaveProperty("log_entry");
  });

  test("surfaces new_damaged, which a writeoff is the whole point of", async () => {
    const { res, body } = await adjust({ new_stock: 10, new_damaged: 2 });
    expect(res.status).toBe(200);
    expect(body.new_stock).toBe(10);
    expect(body.new_damaged).toBe(2);
  });
});

/*
 * Une correction de stock doit pouvoir viser une TAILLE. « Il manque trois
 * Grand » n'est pas « il manque trois du produit » : sans la variante, le
 * total marché bougeait et la répartition par taille restait fausse, ce que
 * seul un comptage physique aurait fini par révéler.
 *
 * `p_variant_id` a un défaut NULL en SQL, donc l'appel historique à six
 * arguments continue de fonctionner mot pour mot.
 */
describe("POST /api/products/[id]/stock — la correction peut viser une variante", () => {
  function wire() {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    mockFrom
      .mockReturnValueOnce(singleChain({ role: "super_admin", market_id: null }))
      .mockReturnValueOnce(
        singleChain({ market_id: "m-tn", current_stock: 10, damaged_return_count: 0 }),
      );
    mockRpc.mockResolvedValue({ data: [{ new_stock: 15, new_damaged: 0 }], error: null });
  }

  test("transmet variant_id à la RPC", async () => {
    wire();
    const res = await POST(
      postReq({ change: 5, reason: "manual_adjustment", note: "r", variant_id: "v-grand" }),
      params,
    );

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      "adjust_product_stock",
      expect.objectContaining({ p_variant_id: "v-grand" }),
    );
  });

  test("envoie null quand aucune variante n'est nommée", async () => {
    wire();
    await POST(postReq({ change: 5, reason: "manual_adjustment", note: "r" }), params);

    expect(mockRpc).toHaveBeenCalledWith(
      "adjust_product_stock",
      expect.objectContaining({ p_variant_id: null }),
    );
  });

  test("refuse un variant_id qui n'est pas une chaîne", async () => {
    wire();
    const res = await POST(
      postReq({ change: 5, reason: "manual_adjustment", note: "r", variant_id: 7 }),
      params,
    );

    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  // La RPC refuse une variante étrangère au produit ou un palier. C'est une
  // saisie fautive, pas une panne du serveur.
  test("une variante refusée par la RPC rend 400, pas 500", async () => {
    wire();
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Cette variante n'appartient pas au produit, ou ne porte pas de stock" },
    });

    const res = await POST(
      postReq({ change: 5, reason: "manual_adjustment", note: "r", variant_id: "v-autre" }),
      params,
    );
    expect(res.status).toBe(400);
  });

  // Vider le total sous la somme de ses variantes est refusé par la RPC avec un
  // message qui dit quoi faire. Le traduire en 500 le rendrait illisible.
  test("un retrait sous la somme des variantes rend 400", async () => {
    wire();
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        message:
          "Ce retrait ferait passer le total sous la somme de ses variantes — retirez d'une variante",
      },
    });

    const res = await POST(
      postReq({ change: -50, reason: "manual_adjustment", note: "r" }),
      params,
    );
    expect(res.status).toBe(400);
  });
});
