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

function singleChain(data: unknown, error: unknown = null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.is = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data, error });
  return c;
}

function postReq(body: unknown) {
  return new NextRequest(new URL("http://localhost/api/products"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockGetUser.mockReset();
  mockFrom.mockReset();
});

describe("GET /api/products — server-side search", () => {
  test("q param applies an escaped ilike name filter", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });

    const ilike = vi.fn();
    const listChain: Record<string, unknown> = {};
    const passthrough = () => listChain;
    for (const m of ["select", "eq", "order", "range"]) {
      listChain[m] = vi.fn().mockImplementation(passthrough);
    }
    listChain.ilike = vi.fn().mockImplementation((...args: unknown[]) => {
      ilike(...args);
      return listChain;
    });
    listChain.then = (res: (v: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null, count: 0 }).then(res);

    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return singleChain({ role: "super_admin", market_id: null });
      }
      return listChain;
    });

    const url = new URL("http://localhost/api/products");
    url.searchParams.set("market_id", "m-1");
    url.searchParams.set("page", "1");
    url.searchParams.set("q", "crème_50%");
    const res = await GET(new NextRequest(url));

    expect(res.status).toBe(200);
    expect(ilike).toHaveBeenCalledWith("name", "%crème\\_50\\%%");
  });
});

// The four screen defects on /products (NaN costs, uniformly red health dots,
// a toggle that could never deactivate, an "Actifs" filter matching nothing)
// all came from one root cause: the route served product_inventory_view with
// select("*"), and the view carried none of the columns the client declared.
// select("*") makes a missing column silent, so nothing here can be asserted
// by reading the row shape back — the select ARGUMENT is the contract.
describe("GET /api/products — column projection", () => {
  function listChainCapturing(sel: (arg: unknown) => void) {
    const c: Record<string, unknown> = {};
    const pass = () => c;
    for (const m of ["eq", "is", "order", "range", "ilike", "in"]) {
      c[m] = vi.fn().mockImplementation(pass);
    }
    c.select = vi.fn().mockImplementation((...args: unknown[]) => {
      sel(args[0]);
      return c;
    });
    c.then = (res: (v: unknown) => unknown) =>
      Promise.resolve({
        data: [{ id: "p-1", product_variants: [{ count: 2 }] }],
        error: null,
        count: 1,
      }).then(res);
    return c;
  }

  const WIDENED = [
    "unit_cogs",
    "packing_cost",
    "confirmation_processing_cost",
    "default_price",
    "is_active",
    "sku",
    "image_url",
  ];

  test("manager/admin path selects every widened column explicitly, never '*'", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    let selectArg: unknown;
    const chain = listChainCapturing((a) => {
      selectArg = a;
    });
    const tables: string[] = [];
    mockFrom.mockImplementation((table: string) => {
      tables.push(table);
      if (table === "users") return singleChain({ role: "super_admin", market_id: null });
      return chain;
    });

    const url = new URL("http://localhost/api/products");
    url.searchParams.set("market_id", "m-1");
    url.searchParams.set("page", "1");
    const res = await GET(new NextRequest(url));

    expect(res.status).toBe(200);
    expect(tables).toContain("product_inventory_view");
    const sel = String(selectArg);
    expect(sel).not.toBe("*");
    for (const col of WIDENED) expect(sel).toContain(col);
    expect(sel).toContain("product_variants(count)");
  });

  test("no second products lookup — the widened view carries image_url", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    const chain = listChainCapturing(() => {});
    const tables: string[] = [];
    mockFrom.mockImplementation((table: string) => {
      tables.push(table);
      if (table === "users") return singleChain({ role: "super_admin", market_id: null });
      return chain;
    });

    const url = new URL("http://localhost/api/products");
    url.searchParams.set("market_id", "m-1");
    url.searchParams.set("page", "1");
    await GET(new NextRequest(url));

    // "products" would mean the deleted image backfill round trip came back.
    expect(tables.filter((t) => t === "products")).toHaveLength(0);
  });

  test("agent path stays narrow — no financial columns in the select", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "ag-1" } }, error: null });
    let selectArg: unknown;
    const chain = listChainCapturing((a) => {
      selectArg = a;
    });
    const tables: string[] = [];
    mockFrom.mockImplementation((table: string) => {
      tables.push(table);
      if (table === "users") return singleChain({ role: "agent", market_id: "m-1" });
      return chain;
    });

    const res = await GET(new NextRequest(new URL("http://localhost/api/products")));

    expect(res.status).toBe(200);
    expect(tables).toContain("products");
    expect(tables).not.toContain("product_inventory_view");
    const sel = String(selectArg);
    for (const col of ["unit_cogs", "packing_cost", "confirmation_processing_cost"]) {
      expect(sel).not.toContain(col);
    }
  });

  test("an agent still receives the selling price — it is not a cost", async () => {
    // ConvertLeadModal prefills the order from default_price. Without it the
    // price falls back to 0, and four Tunisian orders were confirmed at
    // 0.000 on 2026-05-05 because of exactly that. Revenue is
    // orders.total_price only, so those are invisible in every P&L.
    mockGetUser.mockResolvedValue({ data: { user: { id: "ag-1" } }, error: null });
    let selectArg: unknown;
    const chain = listChainCapturing((a) => {
      selectArg = a;
    });
    mockFrom.mockImplementation((table: string) =>
      table === "users" ? singleChain({ role: "agent", market_id: "m-1" }) : chain,
    );

    await GET(new NextRequest(new URL("http://localhost/api/products")));

    expect(String(selectArg)).toContain("default_price");
  });

  test("legacy call without ?page still returns a bare { data } envelope", async () => {
    // MappingsPageClient, OrdersPageClient, NewLeadModal, ConvertLeadModal and
    // AdminPositionsPanel all rely on this shape.
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    const chain = listChainCapturing(() => {});
    mockFrom.mockImplementation((table: string) =>
      table === "users" ? singleChain({ role: "super_admin", market_id: null }) : chain,
    );

    const url = new URL("http://localhost/api/products");
    url.searchParams.set("market_id", "m-1");
    const res = await GET(new NextRequest(url));
    const json = (await res.json()) as Record<string, unknown>;

    expect(Array.isArray(json.data)).toBe(true);
    expect(json.pagination).toBeUndefined();
  });

  test("is_active=true applies a filter — NewLeadModal has always sent it unread", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    const eqCalls: unknown[][] = [];
    const c: Record<string, unknown> = {};
    const pass = () => c;
    for (const m of ["select", "order", "range", "ilike", "in"]) {
      c[m] = vi.fn().mockImplementation(pass);
    }
    c.eq = vi.fn().mockImplementation((...args: unknown[]) => {
      eqCalls.push(args);
      return c;
    });
    c.is = vi.fn().mockReturnValue(c);
    c.then = (res: (v: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null, count: 0 }).then(res);

    mockFrom.mockImplementation((table: string) =>
      table === "users" ? singleChain({ role: "super_admin", market_id: null }) : c,
    );

    const url = new URL("http://localhost/api/products");
    url.searchParams.set("market_id", "m-1");
    url.searchParams.set("is_active", "true");
    await GET(new NextRequest(url));

    expect(eqCalls).toContainEqual(["is_active", true]);
  });
});

describe("POST /api/products — stock integrity lockdown", () => {
  test("rejects market_manager with 403 (product management is super_admin only)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    mockFrom.mockReturnValueOnce(
      singleChain({ role: "market_manager", market_id: "m-tn" }),
    );
    const res = await POST(
      postReq({ name: "Test", unit_cogs: 1, packing_cost: 1 }),
    );
    expect(res.status).toBe(403);
  });

  test("rejects warehouse_agent with 403", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    mockFrom.mockReturnValueOnce(
      singleChain({ role: "warehouse_agent", market_id: "m-tn" }),
    );
    const res = await POST(
      postReq({ name: "Test", unit_cogs: 1, packing_cost: 1 }),
    );
    expect(res.status).toBe(403);
  });

  test("rejects agent with 403", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "ag-1" } } });
    mockFrom.mockReturnValueOnce(
      singleChain({ role: "agent", market_id: "m-tn" }),
    );
    const res = await POST(
      postReq({ name: "Test", unit_cogs: 1, packing_cost: 1 }),
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /api/products — sku handling", () => {
  function insertChain(data: unknown, error: unknown = null) {
    const c: Record<string, unknown> = {};
    const insertSpy = vi.fn().mockReturnValue(c);
    c.insert = insertSpy;
    c.select = vi.fn().mockReturnValue(c);
    c.single = vi.fn().mockResolvedValue({ data, error });
    return { chain: c, insertSpy };
  }

  test("super_admin POST persists sku in the inserted row", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    const products = insertChain({ id: "p-new", name: "X", sku: "BV-01" });
    mockFrom
      .mockReturnValueOnce(singleChain({ role: "super_admin", market_id: null }))
      .mockReturnValueOnce(products.chain);

    const res = await POST(
      postReq({
        name: "X",
        unit_cogs: 1,
        packing_cost: 0,
        market_id: "m-tn",
        sku: "BV-01",
      }),
    );

    expect(res.status).toBe(201);
    expect(products.insertSpy).toHaveBeenCalled();
    const insertedRow = products.insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(insertedRow.sku).toBe("BV-01");
  });

  test("super_admin POST does not include sku when omitted by client", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    const products = insertChain({ id: "p-new", name: "X" });
    mockFrom
      .mockReturnValueOnce(singleChain({ role: "super_admin", market_id: null }))
      .mockReturnValueOnce(products.chain);

    await POST(
      postReq({
        name: "X",
        unit_cogs: 1,
        packing_cost: 0,
        market_id: "m-tn",
      }),
    );

    const insertedRow = products.insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(insertedRow.sku).toBeNull();
  });

  test("returns 409 when SKU collides (unique index 23505)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    const products = insertChain(null, { code: "23505", message: "duplicate key" });
    mockFrom
      .mockReturnValueOnce(singleChain({ role: "super_admin", market_id: null }))
      .mockReturnValueOnce(products.chain);

    const res = await POST(
      postReq({
        name: "X",
        unit_cogs: 1,
        packing_cost: 0,
        market_id: "m-tn",
        sku: "DUP",
      }),
    );

    expect(res.status).toBe(409);
  });
});

// `initial_stock` is the OPENING BALANCE — the count the product entered the
// system with. It never moves again. `current_stock` is the running figure.
// The route wrote the submitted quantity to `current_stock` alone, so every
// product created through this route kept `initial_stock = 0` (the column
// default) while holding real stock. `product_inventory_view.real_inventory`
// is `initial_stock − delivered`, so it went negative the moment the product
// delivered anything — 9 of 13 live products were in that state.
describe("POST /api/products — initial_stock is the opening balance", () => {
  function insertChain(data: unknown, error: unknown = null) {
    const c: Record<string, unknown> = {};
    const insertSpy = vi.fn().mockReturnValue(c);
    c.insert = insertSpy;
    c.select = vi.fn().mockReturnValue(c);
    c.single = vi.fn().mockResolvedValue({ data, error });
    return { chain: c, insertSpy };
  }

  function createWith(initialStock: unknown) {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    const products = insertChain({ id: "p-new", name: "X" });
    const ledger = insertChain({ id: "log-1" });
    mockFrom
      .mockReturnValueOnce(singleChain({ role: "super_admin", market_id: null }))
      .mockReturnValueOnce(products.chain)
      .mockReturnValueOnce(ledger.chain);

    const res = POST(
      postReq({
        name: "X",
        unit_cogs: 1,
        packing_cost: 0,
        market_id: "m-tn",
        initial_stock: initialStock,
      }),
    );
    return { res, products, ledger };
  }

  test("persists initial_stock alongside current_stock", async () => {
    const { res, products } = createWith(250);
    expect((await res).status).toBe(201);

    const row = products.insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(row.initial_stock).toBe(250);
    expect(row.current_stock).toBe(250);
  });

  test("opening balance equals the ledger movement it books", async () => {
    const { res, products, ledger } = createWith(250);
    await res;

    const row = products.insertSpy.mock.calls[0][0] as Record<string, unknown>;
    const logRow = ledger.insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(logRow.reason).toBe("initial_stock");
    expect(logRow.change).toBe(row.initial_stock);
    expect(logRow.balance_after).toBe(row.current_stock);
  });

  test("defaults to 0 when omitted, and books no ledger movement", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    const products = insertChain({ id: "p-new", name: "X" });
    mockFrom
      .mockReturnValueOnce(singleChain({ role: "super_admin", market_id: null }))
      .mockReturnValueOnce(products.chain);

    await POST(
      postReq({ name: "X", unit_cogs: 1, packing_cost: 0, market_id: "m-tn" }),
    );

    const row = products.insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(row.initial_stock).toBe(0);
    expect(row.current_stock).toBe(0);
    // "products" is the second from(), after "users" — a third would be the log.
    expect(mockFrom).toHaveBeenCalledTimes(2);
  });

  test("a non-numeric initial_stock falls back to 0 rather than NaN", async () => {
    const { res, products } = createWith("250");
    expect((await res).status).toBe(201);

    const row = products.insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(row.initial_stock).toBe(0);
    expect(row.current_stock).toBe(0);
  });
});

/*
 * CRÉER UN PRODUIT AVEC SES TAILLES, EN UNE SEULE REQUÊTE.
 *
 * Jusqu'ici il fallait créer le produit, puis aller l'éditer pour lui ajouter
 * ses variantes — et le catalogue porte la même doudoune en trois produits
 * séparés précisément parce que personne ne fait le deuxième pas.
 *
 * Orchestrer côté client (1 + N + M requêtes) multiplierait les fenêtres
 * d'échec : un produit créé, deux variantes sur trois, et aucun moyen de
 * savoir où ça s'est arrêté. Le serveur fait la séquence.
 *
 * LA RÈGLE DU PROTOTYPE : quand le produit se décline, le coût, le prix, le
 * SKU et le stock appartiennent aux VARIANTES. Ils ne peuvent pas vivre aux
 * deux endroits, sinon personne ne sait lequel fait foi.
 */
describe("POST /api/products — créer avec ses variantes", () => {
  function wire(opts: { variantIds?: string[]; variantError?: unknown } = {}) {
    const inserted: Record<string, unknown[]> = { products: [], product_variants: [], inventory_log: [] };
    const ids = [...(opts.variantIds ?? ["v-1", "v-2", "v-3"])];

    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    mockFrom.mockImplementation((table: string) => {
      const c: Record<string, unknown> = {};
      c.select = vi.fn(() => c);
      c.eq = vi.fn(() => c);
      c.is = vi.fn(() => c);
      c.insert = vi.fn((row: unknown) => {
        (inserted[table] ??= []).push(row);
        return c;
      });
      if (table === "users") {
        c.single = vi.fn().mockResolvedValue({
          data: { role: "super_admin", market_id: null },
          error: null,
        });
        return c;
      }
      if (table === "products") {
        c.single = vi.fn().mockResolvedValue({ data: { id: "p-new" }, error: null });
        return c;
      }
      if (table === "product_variants") {
        c.single = vi.fn().mockResolvedValue({
          data: opts.variantError ? null : { id: ids.shift() ?? "v-x" },
          error: opts.variantError ?? null,
        });
        return c;
      }
      c.single = vi.fn().mockResolvedValue({ data: null, error: null });
      c.then = (res: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(res);
      return c;
    });
    return inserted;
  }

  const BODY = {
    name: "دميه ملاكمه",
    market_id: "m-ly",
    packing_cost: 1,
    confirmation_processing_cost: 0.5,
    variants: [
      { label: "Petit", sku: "BOX-S", unit_cogs: 25, display_price: 129, initial_stock: 216 },
      { label: "Moyen", sku: "BOX-M", unit_cogs: 20, display_price: 179, initial_stock: 200 },
      { label: "Grand", sku: "BOX-L", unit_cogs: 30, display_price: 199, initial_stock: 600 },
    ],
  };

  test("crée les trois variantes en attribut", async () => {
    const inserted = wire();
    const res = await POST(postReq(BODY));

    expect(res.status).toBe(201);
    expect(inserted.product_variants).toHaveLength(3);
    expect(inserted.product_variants[0]).toMatchObject({
      product_id: "p-new",
      kind: "attribute",
      label: "Petit",
      sku: "BOX-S",
      unit_cogs: 25,
      display_price: 129,
    });
  });

  // Le total du produit est la SOMME des variantes : 216 + 200 + 600.
  test("le stock du produit est la somme de ses variantes", async () => {
    const inserted = wire();
    await POST(postReq(BODY));

    expect(inserted.products[0]).toMatchObject({
      initial_stock: 1016,
      current_stock: 1016,
    });
  });

  /*
   * Le coût, le prix et le SKU vivent dans les variantes. Les laisser aussi
   * sur le produit créerait deux vérités — et c'est le produit que lisent les
   * finances quand la variante est absente, donc la fausse gagnerait.
   */
  test("le coût, le prix et le SKU quittent le produit", async () => {
    const inserted = wire();
    await POST(postReq({ ...BODY, unit_cogs: 99, default_price: 999, sku: "BOX" }));

    expect(inserted.products[0]).toMatchObject({
      unit_cogs: 0,
      default_price: null,
      sku: null,
    });
  });

  // Le produit garde ce qui ne varie pas.
  test("l'emballage et la confirmation restent sur le produit", async () => {
    const inserted = wire();
    await POST(postReq(BODY));

    expect(inserted.products[0]).toMatchObject({
      packing_cost: 1,
      confirmation_processing_cost: 0.5,
    });
  });

  /*
   * Une ligne de registre par variante, avec sa variante nommée : c'est ce qui
   * fait monter `product_variants.current_stock` (le trigger de 20260920162309
   * applique chaque mouvement). `balance_after` reste le TOTAL du produit, en
   * cumul, comme pour un produit simple.
   */
  test("une ligne de registre par variante, en cumul", async () => {
    const inserted = wire();
    await POST(postReq(BODY));

    expect(inserted.inventory_log).toHaveLength(3);
    expect(inserted.inventory_log[0]).toMatchObject({
      product_id: "p-new",
      variant_id: "v-1",
      change: 216,
      balance_after: 216,
      reason: "initial_stock",
    });
    expect(inserted.inventory_log[2]).toMatchObject({
      variant_id: "v-3",
      change: 600,
      balance_after: 1016,
    });
  });

  test("une variante à stock nul n'écrit pas de ligne de registre", async () => {
    const inserted = wire({ variantIds: ["v-1", "v-2"] });
    await POST(
      postReq({
        ...BODY,
        variants: [
          { label: "Petit", display_price: 129, initial_stock: 5 },
          { label: "Grand", display_price: 199, initial_stock: 0 },
        ],
      }),
    );
    expect(inserted.inventory_log).toHaveLength(1);
  });

  test("une variante sans nom est refusée avant toute écriture", async () => {
    const inserted = wire();
    const res = await POST(
      postReq({ ...BODY, variants: [{ label: "  ", display_price: 129 }] }),
    );
    expect(res.status).toBe(400);
    expect(inserted.products).toHaveLength(0);
  });

  test("une variante sans prix est refusée", async () => {
    const inserted = wire();
    const res = await POST(
      postReq({ ...BODY, variants: [{ label: "Petit", display_price: 0 }] }),
    );
    expect(res.status).toBe(400);
    expect(inserted.products).toHaveLength(0);
  });

  // Sans `variants`, absolument rien ne change : c'est le cas courant.
  test("sans variantes, le produit simple se comporte comme avant", async () => {
    const inserted = wire();
    const res = await POST(
      postReq({
        name: "Biovera",
        market_id: "m-tn",
        unit_cogs: 12,
        packing_cost: 1,
        default_price: 49,
        sku: "BV-01",
        initial_stock: 30,
      }),
    );

    expect(res.status).toBe(201);
    expect(inserted.product_variants).toHaveLength(0);
    expect(inserted.products[0]).toMatchObject({
      unit_cogs: 12,
      default_price: 49,
      sku: "BV-01",
      initial_stock: 30,
      current_stock: 30,
    });
  });

  /*
   * Si une variante échoue, le produit existe déjà — on ne peut pas revenir en
   * arrière proprement sans transaction. On le DIT plutôt que de rendre 201 sur
   * un produit à moitié construit : l'auteur doit savoir quoi finir à la main.
   */
  test("une variante ratée rend 207 et nomme ce qui a été créé", async () => {
    wire({ variantError: { message: "boom" } });
    const res = await POST(postReq(BODY));

    expect(res.status).toBe(207);
    const body = await res.json();
    expect(body.data.id).toBe("p-new");
    expect(body.variants_created).toBe(0);
    expect(body.error).toBeTruthy();
  });
});
