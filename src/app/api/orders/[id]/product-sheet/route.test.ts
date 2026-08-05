import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});

const mockFrom = vi.fn();
const mockAdminFrom = vi.fn();
const mockAdminRpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({ from: (t: string) => mockFrom(t) }),
  createAdminClient: vi.fn(() => ({
    from: (t: string) => mockAdminFrom(t),
    rpc: (fn: string, args: unknown) => mockAdminRpc(fn, args),
  })),
}));

import { GET } from "./route";
import { NextRequest } from "next/server";
import { setTestActor, resetTestActor } from "@/test/helpers/actorMock";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function chain(data: unknown, error: unknown = null): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = {};
  c.select = vi.fn(() => c);
  c.eq = vi.fn(() => c);
  c.in = vi.fn(() => c);
  c.order = vi.fn(() => c);
  c.single = vi.fn(async () => ({ data, error }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  c.then = (res: any, rej: any) => Promise.resolve({ data, error }).then(res, rej);
  return c;
}

const ORDER = {
  id: "o-1",
  market_id: "m-tn",
  assigned_to: "agent-1",
  product_id: "p-1",
  product_variant_id: null,
  product_name: "Biovera",
  variant_label: null,
  unit_price: 49,
  currency: "TND",
  mapping_status: "mapped",
};

const PRODUCT = {
  id: "p-1",
  market_id: "m-tn",
  name: "Biovera",
  description: "Huile anti-cellulite",
  image_url: "https://cdn/img.png",
  default_price: 49,
  floor_price: 39,
  current_stock: 40,
  low_stock_threshold: 10,
  is_active: true,
  agent_brief: "Stock bleu épuisé",
  agent_brief_tone: "warning",
  agent_notes: "Objection prix → pack 2",
  agent_composition: "Aloe vera, huile d'argan",
  agent_contraindications: "Déconseillé aux femmes enceintes",
  agent_usage: "Matin et soir",
  cross_sell_product_id: null,
  agent_content_updated_at: "2026-08-01T00:00:00Z",
};

const SIGNALS = {
  rejected: 25,
  confirmed: 80,
  delivered: 80,
  returned: 20,
  top_rejection_reason: "prix",
};

/** Column lists passed to admin.from("products").select(...) during a call. */
const productSelects: string[] = [];

interface Wiring {
  order?: unknown;
  orderError?: unknown;
  items?: unknown[];
  product?: unknown;
  productError?: unknown;
  variants?: unknown[];
  signals?: unknown;
  /** Products reachable by the one-hop cross-sell lookup, keyed by id. */
  catalogue?: Record<string, unknown>;
  /** cross_sell_product_id rows returned for the order's own products. */
  hops?: unknown[];
}

function wire({
  order = ORDER,
  orderError = null,
  items = [],
  product = PRODUCT,
  productError = null,
  variants = [],
  signals = SIGNALS,
  catalogue,
  hops,
}: Wiring = {}) {
  mockFrom.mockImplementation((table: string) => {
    if (table === "orders") return chain(order, orderError);
    if (table === "order_items") return chain(items);
    return chain(null);
  });

  // products is hit up to three times: the one-hop allow-set lookup (.in),
  // the main projection (.single), and the cross-sell card (.maybeSingle).
  mockAdminFrom.mockImplementation((table: string) => {
    if (table === "product_variants") return chain(variants);
    if (table !== "products") return chain(null);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c: any = {};
    let requestedId: string | null = null;
    c.select = vi.fn((cols: string) => {
      productSelects.push(cols);
      return c;
    });
    c.eq = vi.fn((_col: string, val: string) => {
      requestedId = val;
      return c;
    });
    c.in = vi.fn(() => ({ ...c, then: (r: (v: unknown) => void) => Promise.resolve({ data: hops ?? [], error: null }).then(r) }));
    c.order = vi.fn(() => c);
    c.single = vi.fn(async () => {
      // When the sheet is showing a cross-sell target, the main projection
      // resolves that product, not the order's own.
      const fromCatalogue = catalogue && requestedId ? catalogue[requestedId] : undefined;
      return { data: fromCatalogue ?? product, error: fromCatalogue ? null : productError };
    });
    c.maybeSingle = vi.fn(async () => ({
      data: catalogue && requestedId ? (catalogue[requestedId] ?? null) : null,
      error: null,
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    c.then = (res: any, rej: any) =>
      Promise.resolve({ data: hops ?? [], error: null }).then(res, rej);
    return c;
  });

  mockAdminRpc.mockResolvedValue({ data: signals ? [signals] : [], error: null });
}

function req(query = "") {
  return new NextRequest(new URL(`http://localhost/api/orders/o-1/product-sheet${query}`));
}

const params = { params: Promise.resolve({ id: "o-1" }) };

beforeEach(() => {
  resetTestActor();
  mockFrom.mockReset();
  mockAdminFrom.mockReset();
  mockAdminRpc.mockReset();
  productSelects.length = 0;
});

describe("GET product-sheet — authorization", () => {
  test("agent assigned to the order gets the sheet", async () => {
    setTestActor({ id: "agent-1", role: "agent", market_id: "m-tn" });
    wire();
    const res = await GET(req(), params);
    expect(res.status).toBe(200);
  });

  test("agent NOT assigned to the order gets 404, not 403", async () => {
    setTestActor({ id: "other-agent", role: "agent", market_id: "m-tn" });
    wire();
    const res = await GET(req(), params);
    expect(res.status).toBe(404);
  });

  test("market_manager from another market gets 404", async () => {
    setTestActor({ id: "mgr-ly", role: "market_manager", market_id: "m-ly" });
    wire();
    const res = await GET(req(), params);
    expect(res.status).toBe(404);
  });

  test("market_manager in the same market gets the sheet even if unassigned", async () => {
    setTestActor({ id: "mgr-tn", role: "market_manager", market_id: "m-tn" });
    wire();
    const res = await GET(req(), params);
    expect(res.status).toBe(200);
  });

  test("super_admin gets the sheet cross-market", async () => {
    setTestActor({ id: "sa", role: "super_admin", market_id: null });
    wire();
    const res = await GET(req(), params);
    expect(res.status).toBe(200);
  });

  test("warehouse_agent is forbidden", async () => {
    setTestActor({ id: "wh", role: "warehouse_agent", market_id: "m-tn" });
    wire();
    const res = await GET(req(), params);
    expect(res.status).toBe(403);
  });

  test("investor is forbidden", async () => {
    setTestActor({ id: "inv", role: "investor", market_id: "m-tn" });
    wire();
    const res = await GET(req(), params);
    expect(res.status).toBe(403);
  });

  test("missing order is 404", async () => {
    setTestActor({ id: "agent-1", role: "agent", market_id: "m-tn" });
    wire({ order: null, orderError: { message: "no rows" } });
    const res = await GET(req(), params);
    expect(res.status).toBe(404);
  });
});

describe("GET product-sheet — cost leakage", () => {
  test("never returns COGS or other financial columns", async () => {
    setTestActor({ id: "agent-1", role: "agent", market_id: "m-tn" });
    wire();
    const res = await GET(req(), params);
    const body = await res.text();
    expect(body).not.toContain("unit_cogs");
    expect(body).not.toContain("packing_cost");
    expect(body).not.toContain("confirmation_processing_cost");
    expect(body).not.toContain("damaged_return_count");
  });

  test("DOES return floor_price — agents need it to negotiate", async () => {
    setTestActor({ id: "agent-1", role: "agent", market_id: "m-tn" });
    wire();
    const json = await (await GET(req(), params)).json();
    expect(json.product.floor_price).toBe(39);
  });

  test("requests an explicit column list rather than select('*')", async () => {
    setTestActor({ id: "agent-1", role: "agent", market_id: "m-tn" });
    wire();
    await GET(req(), params);

    expect(productSelects.length).toBeGreaterThan(0);
    for (const cols of productSelects) {
      expect(cols).not.toBe("*");
      expect(cols).not.toContain("unit_cogs");
      expect(cols).not.toContain("packing_cost");
    }
    expect(productSelects.some((c) => c.includes("agent_brief"))).toBe(true);
  });
});

describe("GET product-sheet — payload", () => {
  test("returns product content, variants and an empty check list when healthy", async () => {
    setTestActor({ id: "agent-1", role: "agent", market_id: "m-tn" });
    wire({
      variants: [
        { id: "v-1", label: "1 pc", quantity: 1, display_price: 49, is_active: true, agent_note: null },
      ],
    });
    const res = await GET(req(), params);
    const json = await res.json();
    expect(json.product.agent_brief).toBe("Stock bleu épuisé");
    expect(json.product.agent_brief_tone).toBe("warning");
    expect(json.variants).toHaveLength(1);
    expect(json.checks).toEqual([]);
    expect(json.currency).toBe("TND");
  });

  test("falls back to the single existing image as the gallery", async () => {
    setTestActor({ id: "agent-1", role: "agent", market_id: "m-tn" });
    wire();
    const json = await (await GET(req(), params)).json();
    expect(json.media).toEqual([
      expect.objectContaining({ url: "https://cdn/img.png", position: 0 }),
    ]);
  });

  test("returns an empty gallery when the product has no image", async () => {
    setTestActor({ id: "agent-1", role: "agent", market_id: "m-tn" });
    wire({ product: { ...PRODUCT, image_url: null } });
    const json = await (await GET(req(), params)).json();
    expect(json.media).toEqual([]);
  });
});

// orders.currency is NULL on every historical row (the column arrived with the
// storefront-mapping migration and only new webhook intake fills it). Falling
// back to "" rendered a bare "49" in the sheet and in the WhatsApp message.
describe("GET product-sheet — currency fallback", () => {
  test("falls back to the market currency when the order has none", async () => {
    setTestActor({ id: "agent-1", role: "agent", market_id: "m-tn" });
    wire({ order: { ...ORDER, currency: null } });
    const json = await (await GET(req(), params)).json();
    expect(json.currency).toBe("TND");
  });

  test("uses the Libya display code for Libya orders with no currency", async () => {
    setTestActor({ id: "agent-1", role: "agent", market_id: "m-ly" });
    const ly = {
      ...ORDER,
      currency: null,
      market_id: "00000000-0000-0000-0000-000000000002",
    };
    wire({
      order: ly,
      product: { ...PRODUCT, market_id: "00000000-0000-0000-0000-000000000002" },
    });
    const json = await (await GET(req(), params)).json();
    expect(json.currency).toBe("LBY");
  });

  test("still honours an explicit order currency", async () => {
    setTestActor({ id: "agent-1", role: "agent", market_id: "m-tn" });
    wire({ order: { ...ORDER, currency: "EUR" } });
    const json = await (await GET(req(), params)).json();
    expect(json.currency).toBe("EUR");
  });

  test("never returns an empty currency, even on an unmapped order", async () => {
    setTestActor({ id: "agent-1", role: "agent", market_id: "m-tn" });
    wire({ order: { ...ORDER, currency: null, product_id: null } });
    const json = await (await GET(req(), params)).json();
    expect(json.product).toBeNull();
    expect(json.currency).toBe("TND");
  });
});

describe("GET product-sheet — unmapped orders", () => {
  test("returns the unmapped check and the raw name when product_id is null", async () => {
    setTestActor({ id: "agent-1", role: "agent", market_id: "m-tn" });
    wire({ order: { ...ORDER, product_id: null, mapping_status: "unmatched" } });
    const res = await GET(req(), params);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.product).toBeNull();
    expect(json.raw_product_name).toBe("Biovera");
    expect(json.checks.map((c: { code: string }) => c.code)).toEqual(["unmapped"]);
  });

  test("returns unmapped when the referenced product row is gone", async () => {
    setTestActor({ id: "agent-1", role: "agent", market_id: "m-tn" });
    wire({ product: null, productError: { message: "no rows" } });
    const json = await (await GET(req(), params)).json();
    expect(json.product).toBeNull();
    expect(json.checks.map((c: { code: string }) => c.code)).toEqual(["unmapped"]);
  });
});

describe("GET product-sheet — verification checks", () => {
  test("surfaces a price mismatch against the catalogue", async () => {
    setTestActor({ id: "agent-1", role: "agent", market_id: "m-tn" });
    wire({ order: { ...ORDER, unit_price: 39 } });
    const json = await (await GET(req(), params)).json();
    const codes = json.checks.map((c: { code: string }) => c.code);
    expect(codes).toContain("price_mismatch");
  });

  test("surfaces a deactivated product — which agent RLS alone would hide", async () => {
    setTestActor({ id: "agent-1", role: "agent", market_id: "m-tn" });
    wire({ product: { ...PRODUCT, is_active: false } });
    const json = await (await GET(req(), params)).json();
    const codes = json.checks.map((c: { code: string }) => c.code);
    expect(codes).toContain("product_inactive");
  });

  test("uses the order_items line price when the order has line items", async () => {
    setTestActor({ id: "agent-1", role: "agent", market_id: "m-tn" });
    wire({
      items: [
        { id: "i-1", product_id: "p-1", variant_id: "v-1", variant_label: "1 pc", unit_price: 29 },
      ],
      variants: [
        { id: "v-1", label: "1 pc", quantity: 1, display_price: 49, is_active: true, agent_note: null },
      ],
    });
    const json = await (await GET(req(), params)).json();
    const priceCheck = json.checks.find((c: { code: string }) => c.code === "price_mismatch");
    expect(priceCheck.values).toMatchObject({ orderPrice: 29, catalogPrice: 49 });
  });
});

describe("GET product-sheet — computed signals", () => {
  test("returns rates derived from the RPC counts", async () => {
    setTestActor({ id: "agent-1", role: "agent", market_id: "m-tn" });
    wire();
    const json = await (await GET(req(), params)).json();
    // 80/(80+25)=76%, 20/(80+20)=20%
    expect(json.signals.confirmation).toMatchObject({ percent: 76, tone: "success" });
    expect(json.signals.returns).toMatchObject({ percent: 20, tone: "warning" });
    expect(json.signals.topRejectionReason).toBe("prix");
  });

  test("scopes the RPC to the order's market", async () => {
    setTestActor({ id: "agent-1", role: "agent", market_id: "m-tn" });
    wire();
    await GET(req(), params);
    const call = mockAdminRpc.mock.calls.find((c) => c[0] === "get_product_agent_signals");
    expect(call?.[1]).toMatchObject({ p_product_id: "p-1", p_market_id: "m-tn" });
  });

  test("degrades to suppressed signals when the product has no history", async () => {
    setTestActor({ id: "agent-1", role: "agent", market_id: "m-tn" });
    wire({ signals: null });
    const json = await (await GET(req(), params)).json();
    expect(json.signals.hasAny).toBe(false);
    expect(json.signals.confirmation).toBeNull();
  });

  test("does not compute signals for an unmapped order", async () => {
    setTestActor({ id: "agent-1", role: "agent", market_id: "m-tn" });
    wire({ order: { ...ORDER, product_id: null } });
    const json = await (await GET(req(), params)).json();
    expect(json.signals).toBeNull();
  });
});

describe("GET product-sheet — cross-sell", () => {
  const ALT = {
    id: "p-alt",
    market_id: "m-tn",
    name: "Biovera Pack Duo",
    image_url: "https://cdn/alt.png",
    default_price: 79,
    is_active: true,
  };

  test("returns the alternative card when the product points at one", async () => {
    setTestActor({ id: "agent-1", role: "agent", market_id: "m-tn" });
    wire({
      product: { ...PRODUCT, cross_sell_product_id: "p-alt" },
      catalogue: { "p-alt": ALT },
    });
    const json = await (await GET(req(), params)).json();
    expect(json.cross_sell).toMatchObject({ id: "p-alt", name: "Biovera Pack Duo" });
  });

  test("hides a deactivated alternative — offering it would waste the call", async () => {
    setTestActor({ id: "agent-1", role: "agent", market_id: "m-tn" });
    wire({
      product: { ...PRODUCT, cross_sell_product_id: "p-alt" },
      catalogue: { "p-alt": { ...ALT, is_active: false } },
    });
    const json = await (await GET(req(), params)).json();
    expect(json.cross_sell).toBeNull();
  });

  test("hides a cross-market alternative", async () => {
    setTestActor({ id: "agent-1", role: "agent", market_id: "m-tn" });
    wire({
      product: { ...PRODUCT, cross_sell_product_id: "p-alt" },
      catalogue: { "p-alt": { ...ALT, market_id: "m-ly" } },
    });
    const json = await (await GET(req(), params)).json();
    expect(json.cross_sell).toBeNull();
  });

  test("allows drilling into the alternative — one hop from an order product", async () => {
    setTestActor({ id: "agent-1", role: "agent", market_id: "m-tn" });
    wire({
      hops: [{ cross_sell_product_id: "p-alt" }],
      catalogue: { "p-alt": { ...PRODUCT, id: "p-alt", name: "Biovera Pack Duo" } },
    });
    const res = await GET(req("?product_id=p-alt"), params);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.product.id).toBe("p-alt");
    expect(json.is_cross_sell_view).toBe(true);
  });

  test("refuses a SECOND hop — the alternative's own alternative", async () => {
    setTestActor({ id: "agent-1", role: "agent", market_id: "m-tn" });
    wire({ hops: [{ cross_sell_product_id: "p-alt" }] });
    const res = await GET(req("?product_id=p-far"), params);
    expect(res.status).toBe(404);
  });

  test("skips order-relative checks on a cross-sell view", async () => {
    setTestActor({ id: "agent-1", role: "agent", market_id: "m-tn" });
    wire({
      order: { ...ORDER, unit_price: 35 },
      hops: [{ cross_sell_product_id: "p-alt" }],
      catalogue: { "p-alt": { ...PRODUCT, id: "p-alt", default_price: 79 } },
    });
    const json = await (await GET(req("?product_id=p-alt"), params)).json();
    const codes = json.checks.map((c: { code: string }) => c.code);
    expect(codes).not.toContain("price_mismatch");
  });
});

describe("GET product-sheet — product_id scoping", () => {
  test("serves a second line item's product when explicitly requested", async () => {
    setTestActor({ id: "agent-1", role: "agent", market_id: "m-tn" });
    wire({
      items: [
        { id: "i-1", product_id: "p-1", variant_id: null, variant_label: null, unit_price: 49 },
        { id: "i-2", product_id: "p-2", variant_id: null, variant_label: null, unit_price: 20 },
      ],
      product: { ...PRODUCT, id: "p-2", name: "Second" },
    });
    const res = await GET(req("?product_id=p-2"), params);
    expect(res.status).toBe(200);
    expect((await res.json()).product.id).toBe("p-2");
  });

  test("refuses a product that is not on this order (no catalogue browsing)", async () => {
    setTestActor({ id: "agent-1", role: "agent", market_id: "m-tn" });
    wire({ items: [] });
    const res = await GET(req("?product_id=p-999"), params);
    expect(res.status).toBe(404);
  });

  test("refuses a product from another market even if ids were guessed", async () => {
    setTestActor({ id: "agent-1", role: "agent", market_id: "m-tn" });
    wire({ product: { ...PRODUCT, market_id: "m-ly" } });
    const res = await GET(req(), params);
    expect(res.status).toBe(404);
  });
});
