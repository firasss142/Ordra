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

import { DELETE, POST } from "./route";
import { NextRequest } from "next/server";

function singleChain(data: unknown, error: unknown = null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data, error });
  return c;
}

const url = "http://localhost/api/products/p-1/archive";
const del = () => new NextRequest(new URL(url), { method: "DELETE" });
const post = () => new NextRequest(new URL(url), { method: "POST" });
const params = { params: Promise.resolve({ id: "p-1" }) };

const asRole = (role: string) => {
  mockGetUser.mockResolvedValue({ data: { user: { id: "u-1" } } });
  mockFrom.mockReturnValueOnce(singleChain({ role, market_id: "m-ly" }));
};

beforeEach(() => vi.clearAllMocks());

describe("DELETE /api/products/[id]/archive — archiver un produit", () => {
  test("401 sans session", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    expect((await DELETE(del(), params)).status).toBe(401);
  });

  // L'archivage retire le produit de TOUS les sélecteurs de la console. Il reste
  // donc avec le rôle qui possède déjà la création, les coûts et le stock —
  // strictement plus étroit que le simple toggle actif/inactif.
  test.each(["agent", "market_manager", "warehouse_agent"])(
    "403 pour %s — seul le super_admin archive",
    async (role) => {
      asRole(role);
      const res = await DELETE(del(), params);
      expect(res.status).toBe(403);
      expect(mockRpc).not.toHaveBeenCalled();
    },
  );

  test("appelle archive_product avec le produit et l'acteur", async () => {
    asRole("super_admin");
    mockRpc.mockResolvedValue({ data: "2026-09-05T10:00:00Z", error: null });
    const res = await DELETE(del(), params);
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("archive_product", {
      p_product_id: "p-1",
      p_actor_id: "u-1",
    });
    await expect(res.json()).resolves.toEqual({
      archived_at: "2026-09-05T10:00:00Z",
    });
  });

  // Le garde-fou vit dans la RPC ; la route doit le traduire en quelque chose
  // que l'interface peut afficher, pas en 500.
  test("422 lisible quand le produit est encore actif", async () => {
    asRole("super_admin");
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Product must be deactivated before it can be archived" },
    });
    const res = await DELETE(del(), params);
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({ error: "product_still_active" });
  });

  test("404 quand le produit n'existe pas", async () => {
    asRole("super_admin");
    mockRpc.mockResolvedValue({ data: null, error: { message: "Product not found" } });
    expect((await DELETE(del(), params)).status).toBe(404);
  });

  test("403 quand la RPC refuse le rôle (défense en profondeur)", async () => {
    asRole("super_admin");
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Not authorized to archive a product" },
    });
    expect((await DELETE(del(), params)).status).toBe(403);
  });

  test("500 générique sur une erreur inattendue, sans fuite du message SQL", async () => {
    asRole("super_admin");
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: 'relation "products" does not exist' },
    });
    const res = await DELETE(del(), params);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Internal server error");
    expect(JSON.stringify(body)).not.toContain("relation");
  });
});

describe("POST /api/products/[id]/archive — restaurer", () => {
  test("403 pour un non super_admin", async () => {
    asRole("market_manager");
    expect((await POST(post(), params)).status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("appelle restore_product", async () => {
    asRole("super_admin");
    mockRpc.mockResolvedValue({ data: true, error: null });
    const res = await POST(post(), params);
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("restore_product", {
      p_product_id: "p-1",
      p_actor_id: "u-1",
    });
  });
});
