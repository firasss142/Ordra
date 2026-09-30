import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

import { GET, POST } from "./route";
import { NextRequest } from "next/server";

function chain(result: { data: unknown; error?: unknown }) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "ilike", "neq", "order", "limit", "insert", "update", "is"]) {
    c[m] = vi.fn(() => c);
  }
  c.single = vi.fn().mockResolvedValue({ data: result.data, error: result.error ?? null });
  c.maybeSingle = vi.fn().mockResolvedValue({ data: result.data, error: result.error ?? null });
  c.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: result.data, error: result.error ?? null }).then(resolve);
  return c;
}

const params = { params: Promise.resolve({ id: "p-1" }) };

function postReq(body: unknown) {
  return new NextRequest(new URL("http://localhost/api/products/p-1/variants"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}
function getReq() {
  return new NextRequest(new URL("http://localhost/api/products/p-1/variants"), {
    method: "GET",
  });
}

function asSuperAdmin() {
  mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
  return mockFrom
    .mockReturnValueOnce(chain({ data: { role: "super_admin", market_id: null } }))
    .mockReturnValueOnce(chain({ data: { market_id: "m-tn" } }));
}

beforeEach(() => {
  mockGetUser.mockReset();
  mockFrom.mockReset();
});

/*
 * LES DEUX AXES.
 *
 * `kind='attribute'` est un objet physique distinct (Petit / Grand) : il porte
 * son stock, son coût et son SKU. `kind='pack'` est une façon de vendre le même
 * objet (« Pack 2 ») : il n'a ni stock ni coût propre, il en consomme
 * `quantity` fois celui de la variante d'attribut.
 *
 * L'API ne connaissait que le second : elle écrivait `label`, `quantity` et
 * `display_price`, et laissait le défaut SQL ('pack') décider du reste. On ne
 * pouvait donc PAS créer une taille depuis l'application — la raison pour
 * laquelle le catalogue porte la même doudoune en trois produits séparés.
 */
describe("GET /api/products/[id]/variants — les colonnes des deux axes", () => {
  test("renvoie kind, sku, coût et stock, pas seulement le palier", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    mockFrom
      .mockReturnValueOnce(chain({ data: { role: "super_admin", market_id: null } }))
      .mockReturnValueOnce(chain({ data: { market_id: "m-tn" } }))
      .mockReturnValueOnce(chain({ data: [] }));

    await GET(getReq(), params);

    const selected = (mockFrom.mock.results[2].value.select as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as string;
    for (const col of ["kind", "sku", "unit_cogs", "current_stock", "damaged_return_count"]) {
      expect(selected).toContain(col);
    }
  });
});

describe("POST /api/products/[id]/variants — créer une variante d'attribut", () => {
  test("crée une taille avec son SKU, son coût et kind='attribute'", async () => {
    asSuperAdmin()
      .mockReturnValueOnce(chain({ data: [] })) // no duplicate label
      .mockReturnValueOnce(chain({ data: { id: "v-1", label: "Grand" } }));

    const res = await POST(
      postReq({
        label: "Grand",
        kind: "attribute",
        sku: "DOU-G",
        unit_cogs: 22,
        display_price: 149,
      }),
      params,
    );

    expect(res.status).toBe(201);
    const inserted = (mockFrom.mock.results[3].value.insert as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.kind).toBe("attribute");
    expect(inserted.sku).toBe("DOU-G");
    expect(inserted.unit_cogs).toBe(22);
    // Une taille n'est pas un multiplicateur : elle vaut toujours une unité.
    expect(inserted.quantity).toBe(1);
  });

  // Le défaut reste 'pack' : les appelants d'avant continuent sans changement,
  // et les deux lignes Biovera existantes gardent leur sens.
  test("sans kind, la variante reste un palier", async () => {
    asSuperAdmin()
      .mockReturnValueOnce(chain({ data: [] }))
      .mockReturnValueOnce(chain({ data: { id: "v-1" } }));

    await POST(postReq({ label: "Pack 2", quantity: 2, display_price: 239 }), params);

    const inserted = (mockFrom.mock.results[3].value.insert as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.kind).toBe("pack");
    expect(inserted.quantity).toBe(2);
  });

  test("refuse un kind inconnu", async () => {
    asSuperAdmin();
    const res = await POST(
      postReq({ label: "X", kind: "bundle", display_price: 10 }),
      params,
    );
    expect(res.status).toBe(400);
  });

  // Un SKU vide n'est pas un SKU : le laisser passer créerait une ligne que
  // l'index unique par marché refuserait au deuxième produit sans SKU.
  test("une chaîne SKU vide devient null", async () => {
    asSuperAdmin()
      .mockReturnValueOnce(chain({ data: [] }))
      .mockReturnValueOnce(chain({ data: { id: "v-1" } }));

    await POST(
      postReq({ label: "Grand", kind: "attribute", sku: "   ", display_price: 149 }),
      params,
    );

    const inserted = (mockFrom.mock.results[3].value.insert as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.sku).toBeNull();
  });

  // Le SKU partage un espace de noms avec `products.sku` dans le marché, gardé
  // par un trigger. Le conflit remonte en 23505 et doit se lire en 409.
  test("un SKU déjà pris rend 409", async () => {
    asSuperAdmin()
      .mockReturnValueOnce(chain({ data: [] }))
      .mockReturnValueOnce(chain({ data: null, error: { code: "23505" } }));

    const res = await POST(
      postReq({ label: "Grand", kind: "attribute", sku: "PRIS", display_price: 149 }),
      params,
    );
    expect(res.status).toBe(409);
  });

  test("un coût négatif est refusé", async () => {
    asSuperAdmin();
    const res = await POST(
      postReq({ label: "Grand", kind: "attribute", unit_cogs: -1, display_price: 149 }),
      params,
    );
    expect(res.status).toBe(400);
  });

  // Le stock n'entre JAMAIS par ici : il n'a qu'un chemin, le registre
  // (adjust_product_stock / record_stock_count). Une variante naît à zéro.
  test("current_stock envoyé dans le corps est ignoré", async () => {
    asSuperAdmin()
      .mockReturnValueOnce(chain({ data: [] }))
      .mockReturnValueOnce(chain({ data: { id: "v-1" } }));

    await POST(
      postReq({ label: "Grand", kind: "attribute", display_price: 149, current_stock: 500 }),
      params,
    );

    const inserted = (mockFrom.mock.results[3].value.insert as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as Record<string, unknown>;
    expect(inserted.current_stock).toBeUndefined();
  });

  test("un market_manager reste interdit", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    mockFrom
      .mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: "m-tn" } }))
      .mockReturnValueOnce(chain({ data: { market_id: "m-tn" } }));

    const res = await POST(
      postReq({ label: "Grand", kind: "attribute", display_price: 149 }),
      params,
    );
    expect(res.status).toBe(403);
  });
});

/*
 * CE QU'UN PRODUIT COÛTE NE REGARDE PAS L'AGENT.
 *
 * Les GRANT PostgreSQL sont par rôle POSTGRES (`authenticated`), pas par rôle
 * applicatif : agent, market_manager et super_admin partagent le même. Révoquer
 * `unit_cogs` en base le retirerait donc aussi au super_admin, et la fiche
 * produit mourrait en « permission denied ». La frontière ne peut vivre qu'au
 * niveau de l'application — c'est-à-dire dans la liste de colonnes de chaque
 * route qu'un agent peut atteindre.
 *
 * Cette route-ci est la seule dans ce cas : elle laisse l'agent passer
 * explicitement (sélecteur de commande), et elle sélectionnait `unit_cogs`.
 * `/api/products` le faisait déjà correctement avec AGENT_COLUMNS ; toutes les
 * autres routes qui lisent un coût refusent l'agent avant d'y arriver.
 */
describe("GET /api/products/[id]/variants — l'agent ne reçoit aucun coût", () => {
  function asRole(role: string) {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-1" } } });
    mockFrom
      .mockReturnValueOnce(chain({ data: { role, market_id: "m-tn" } }))
      .mockReturnValueOnce(chain({ data: { market_id: "m-tn" } }))
      .mockReturnValueOnce(chain({ data: [] }));
  }

  function selectedColumns(): string {
    return (mockFrom.mock.results[2].value.select as ReturnType<typeof vi.fn>)
      .mock.calls[0][0] as string;
  }

  test("un agent ne reçoit ni coût unitaire ni casse", async () => {
    asRole("agent");
    const res = await GET(getReq(), params);

    expect(res.status).toBe(200);
    const cols = selectedColumns();
    expect(cols).not.toContain("unit_cogs");
    expect(cols).not.toContain("damaged_return_count");
  });

  // Ce dont l'agent a besoin pour proposer un palier en plein appel.
  test("un agent reçoit quand même le libellé, le prix et le stock", async () => {
    asRole("agent");
    await GET(getReq(), params);

    const cols = selectedColumns();
    for (const c of ["id", "product_id", "kind", "label", "display_price", "current_stock", "is_active"]) {
      expect(cols).toContain(c);
    }
  });

  test("un super_admin reçoit toujours le coût", async () => {
    asRole("super_admin");
    await GET(getReq(), params);
    expect(selectedColumns()).toContain("unit_cogs");
  });

  test("un market_manager reçoit toujours le coût", async () => {
    asRole("market_manager");
    await GET(getReq(), params);
    expect(selectedColumns()).toContain("unit_cogs");
  });
});
