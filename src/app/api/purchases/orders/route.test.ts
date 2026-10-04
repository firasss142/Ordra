import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetActor = vi.fn();
const state = {
  orders: [] as Record<string, unknown>[],
  lines: [] as Record<string, unknown>[],
  rpc: null as { name: string; args: Record<string, unknown> } | null,
  rpcError: null as { message: string; details?: string } | null,
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (table: string) => {
      const rows = table === "purchase_order_line_progress" ? state.lines : state.orders;
      const chain: Record<string, unknown> = {
        then: (res: (v: unknown) => unknown) =>
          Promise.resolve({ data: rows, error: null }).then(res),
      };
      for (const m of ["select", "eq", "in", "order", "limit"]) {
        chain[m] = vi.fn().mockReturnValue(chain);
      }
      return chain;
    },
    rpc: vi.fn().mockImplementation((name: string, args: Record<string, unknown>) => {
      state.rpc = { name, args };
      return Promise.resolve(
        state.rpcError
          ? { data: null, error: state.rpcError }
          : { data: { purchase_order_id: "po-new", reference: "BC-LY-2026-0007" }, error: null },
      );
    }),
  }),
}));

vi.mock("@/lib/auth/actor", () => ({ getActor: (...a: unknown[]) => mockGetActor(...a) }));

import { GET, POST } from "./route";
import { NextRequest } from "next/server";

function get(qs = "") {
  return new NextRequest(new URL(`http://localhost/api/purchases/orders${qs}`));
}
function post(body: unknown) {
  return new NextRequest(new URL("http://localhost/api/purchases/orders"), {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.rpc = null;
  state.rpcError = null;
  state.orders = [
    {
      id: "po-1",
      reference: "BC-LY-2026-0001",
      market_id: "m-ly",
      warehouse_id: "w-tripoli",
      supplier_id: "s-1",
      status: "open",
      wanted_by: "2026-10-14",
      ordered_at: "2026-10-04T08:00:00Z",
      closed_at: null,
      close_reason: null,
      note: null,
      warehouses: { code: "tripoli", name_fr: "Tripoli", name_ar: "طرابلس" },
      suppliers: { name: "مكتبة الرسالة" },
      users: { full_name: "Salma" },
    },
  ];
  state.lines = [
    {
      id: "l-1",
      purchase_order_id: "po-1",
      product_id: "p-1",
      variant_id: null,
      ordered_qty: 150,
      unit_cost: 85,
      received_qty: 94,
      first_received_at: "2026-10-12T00:00:00Z",
    },
  ];
  mockGetActor.mockResolvedValue({
    actor: { id: "m-1", role: "market_manager", market_id: "m-ly" },
  });
});

describe("GET /api/purchases/orders", () => {
  test("rend les commandes projetées, manque compris", async () => {
    const res = await GET(get());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.orders).toHaveLength(1);
    expect(body.orders[0].outstanding_units).toBe(56);
    expect(body.orders[0].supplier_name).toBe("مكتبة الرسالة");
  });

  /*
   * LE QUAI NE LIT PAS L'ATTENDU. La RLS le refuserait déjà, mais une route ne
   * doit jamais s'appuyer sur la base pour dire non — c'est la règle du projet.
   */
  test("refuse l'agent du quai", async () => {
    mockGetActor.mockResolvedValue({
      actor: { id: "a-1", role: "warehouse_agent", market_id: "m-ly", warehouse_id: "w-tripoli" },
    });
    expect((await GET(get())).status).toBe(403);
  });

  test("un super_admin doit nommer son marché", async () => {
    mockGetActor.mockResolvedValue({
      actor: { id: "sa", role: "super_admin", market_id: null },
    });
    expect((await GET(get())).status).toBe(400);
    expect((await GET(get("?market_id=m-ly"))).status).toBe(200);
  });
});

describe("POST /api/purchases/orders", () => {
  test("passe la commande par la RPC", async () => {
    const res = await POST(
      post({
        supplier_id: "s-1",
        warehouse_id: "w-tripoli",
        wanted_by: "2026-10-14",
        lines: [{ product_id: "p-1", qty: 150, unit_cost: 85 }],
      }),
    );
    expect(res.status).toBe(200);
    expect(state.rpc?.name).toBe("create_purchase_order");
    expect(state.rpc?.args.p_actor_id).toBe("m-1");
    expect(state.rpc?.args.p_lines).toEqual([
      { product_id: "p-1", variant_id: null, qty: 150, unit_cost: 85 },
    ]);
  });

  test("refuse une commande sans ligne", async () => {
    const res = await POST(post({ supplier_id: "s-1", warehouse_id: "w-tripoli", lines: [] }));
    expect(res.status).toBe(400);
    expect(state.rpc).toBeNull();
  });

  test("refuse une quantité nulle ou négative sans appeler la base", async () => {
    const res = await POST(
      post({
        supplier_id: "s-1",
        warehouse_id: "w-tripoli",
        lines: [{ product_id: "p-1", qty: 0 }],
      }),
    );
    expect(res.status).toBe(400);
    expect(state.rpc).toBeNull();
  });

  test("laisse `unit_cost` à null plutôt que de le deviner", async () => {
    // Un prix absent n'est pas un prix de zéro : la ligne reste non chiffrée.
    await POST(
      post({
        supplier_id: "s-1",
        warehouse_id: "w-tripoli",
        lines: [{ product_id: "p-1", qty: 10 }],
      }),
    );
    expect(
      (state.rpc?.args.p_lines as Array<{ unit_cost: unknown }>)[0].unit_cost,
    ).toBeNull();
  });

  test("refuse un rôle qui ne commande pas", async () => {
    mockGetActor.mockResolvedValue({
      actor: { id: "a-1", role: "warehouse_agent", market_id: "m-ly" },
    });
    const res = await POST(
      post({ supplier_id: "s-1", warehouse_id: "w", lines: [{ product_id: "p", qty: 1 }] }),
    );
    expect(res.status).toBe(403);
    expect(state.rpc).toBeNull();
  });

  test("traduit le refus de la base en statut HTTP", async () => {
    state.rpcError = { message: "interdit", details: '{"code":"FORBIDDEN"}' };
    const res = await POST(
      post({ supplier_id: "s-1", warehouse_id: "w", lines: [{ product_id: "p", qty: 1 }] }),
    );
    expect(res.status).toBe(403);
  });
});
