import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetActor = vi.fn();
const state = {
  rows: [] as Record<string, unknown>[],
  inserted: null as Record<string, unknown> | null,
  insertError: null as { code?: string; message: string } | null,
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: () => {
      const chain: Record<string, unknown> = {
        then: (res: (v: unknown) => unknown) =>
          Promise.resolve({ data: state.rows, error: null }).then(res),
      };
      for (const m of ["select", "eq", "order", "ilike"]) {
        chain[m] = vi.fn().mockReturnValue(chain);
      }
      chain.insert = vi.fn().mockImplementation((row: Record<string, unknown>) => {
        state.inserted = row;
        return {
          select: () => ({
            single: () =>
              Promise.resolve(
                state.insertError
                  ? { data: null, error: state.insertError }
                  : { data: { id: "s-new", ...row }, error: null }
              ),
          }),
        };
      });
      return chain;
    },
  }),
}));

vi.mock("@/lib/auth/actor", () => ({ getActor: (...a: unknown[]) => mockGetActor(...a) }));

import { GET, POST } from "./route";
import { NextRequest } from "next/server";

function get(qs = "") {
  return new NextRequest(new URL(`http://localhost/api/suppliers${qs}`));
}
function post(body: unknown) {
  return new NextRequest(new URL("http://localhost/api/suppliers"), {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.rows = [{ id: "s-1", name: "مكتبة الرسالة", category: "livres", city: "Misrata", is_active: true }];
  state.inserted = null;
  state.insertError = null;
  mockGetActor.mockResolvedValue({ actor: { id: "m-1", role: "market_manager", market_id: "m-ly" } });
});

describe("GET /api/suppliers", () => {
  test("un manager lit les siens", async () => {
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect((await res.json()).suppliers[0]).toMatchObject({ id: "s-1", name: "مكتبة الرسالة" });
  });

  test("un agent d'entrepôt lit aussi — un NOM n'est pas un prix", async () => {
    // La feuille de réception affiche déjà « مكتبة الرسالة » en tête pour tous
    // les rôles ; ce sont les montants qui sont retirés de la projection.
    mockGetActor.mockResolvedValue({ actor: { id: "w-1", role: "warehouse_agent", market_id: "m-ly" } });
    expect((await GET(get())).status).toBe(200);
  });

  test("un agent de confirmation n'a rien à faire ici", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "a-1", role: "agent", market_id: "m-ly" } });
    expect((await GET(get())).status).toBe(403);
  });

  test("un super_admin doit nommer son marché", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
    expect((await GET(get())).status).toBe(400);
    expect((await GET(get("?market_id=m-ly"))).status).toBe(200);
  });
});

describe("POST /api/suppliers", () => {
  test("crée un fournisseur dans le marché de l'acteur", async () => {
    const res = await POST(post({ name: "الوفرة للتوزيع", category: "jouets" }));
    expect(res.status).toBe(201);
    expect(state.inserted).toMatchObject({
      name: "الوفرة للتوزيع",
      category: "jouets",
      market_id: "m-ly",
      created_by: "m-1",
    });
  });

  test("le marché vient de l'acteur, jamais du corps de la requête", async () => {
    // Même règle que partout : accepter un market_id du client laisserait un
    // manager écrire dans l'autre marché.
    await POST(post({ name: "X", market_id: "m-tn" }));
    expect(state.inserted).toMatchObject({ market_id: "m-ly" });
  });

  test("un nom vide est refusé", async () => {
    expect((await POST(post({ name: "   " }))).status).toBe(400);
    expect(state.inserted).toBeNull();
  });

  test("le nom est débarrassé de ses espaces de bord", async () => {
    await POST(post({ name: "  Biovera Import  " }));
    expect(state.inserted).toMatchObject({ name: "Biovera Import" });
  });

  test("un doublon répond 409, pas 500", async () => {
    // L'index unique est insensible à la casse : « biovera » après « Biovera »
    // remonte 23505, et l'écran doit pouvoir le dire en français.
    state.insertError = { code: "23505", message: "duplicate key" };
    expect((await POST(post({ name: "Biovera" }))).status).toBe(409);
  });

  test("un agent d'entrepôt ne crée pas de fournisseur — c'est un geste de bureau", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "w-1", role: "warehouse_agent", market_id: "m-ly" } });
    expect((await POST(post({ name: "X" }))).status).toBe(403);
    expect(state.inserted).toBeNull();
  });
});
