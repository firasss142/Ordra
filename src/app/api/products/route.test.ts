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
    for (const m of ["eq", "order", "range", "ilike", "in"]) {
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
