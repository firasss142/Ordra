import { describe, test, expect, vi, beforeEach } from "vitest";

/** The leads query: .select().eq()...order() — chainable, resolved at the end. */
const mockLeadsResult = vi.fn();
const mockOrdersIn = vi.fn();
const mockEnrich = vi.fn();

function chain(table: string) {
  const self: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "not", "or", "gte", "lte", "order", "limit", "range"]) {
    self[m] = vi.fn(() => self);
  }
  // `await`ing the builder runs the query.
  self.then = (resolve: (v: unknown) => void) =>
    resolve(table === "orders" ? mockOrdersIn() : mockLeadsResult());
  return self;
}

const mockFrom = vi.fn((table: string) => chain(table));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...(args as [string])),
  }),
}));
vi.mock("@/lib/auth/actor", () => ({ getActor: vi.fn() }));
vi.mock("@/lib/customer-history/enrich", () => ({
  enrichRowsWithCustomerHistory: (...a: unknown[]) => mockEnrich(...a),
}));

import { GET } from "./route";
import { getActor } from "@/lib/auth/actor";
import { NextRequest } from "next/server";

const LY = "00000000-0000-0000-0000-000000000002";
const TN = "00000000-0000-0000-0000-000000000001";
const AGENT_B = "6e5367ef-f04d-412b-886d-f8b9dae6b148";

const req = (q = "") => new NextRequest(new URL(`http://localhost:3000/api/prospects/worklist${q}`));
const as = (id: string, role: string, market_id: string | null) =>
  vi.mocked(getActor).mockResolvedValue({ actor: { id, role, market_id } } as never);

/** A `leads` row as the select returns it, embeds included. */
const lead = (over: Record<string, unknown> = {}) => ({
  id: "l1",
  market_id: LY,
  status: "assigned",
  source: "whatsapp",
  customer_name: "أمل",
  customer_phone: "0917788001",
  customer_city: "طرابلس",
  customer_address: null,
  product_interest_id: null,
  product_interest_note: null,
  notes: null,
  assigned_to: "a1",
  callback_scheduled_at: null,
  converted_order_id: null,
  campaign_id: null,
  source_order_id: null,
  return_reason: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  products: null,
  prospect_campaigns: null,
  users: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockLeadsResult.mockReturnValue({ data: [], error: null, count: 0 });
  mockOrdersIn.mockReturnValue({ data: [], error: null });
  // By default the enrichment is a pass-through with empty history.
  mockEnrich.mockImplementation((_c, _m, _s, rows: Record<string, unknown>[]) =>
    Promise.resolve(
      rows.map((r) => ({
        ...r,
        repeat_kind: "none",
        prior_order_count: 0,
        prior_lead_count: 0,
        prior_rejected_count: 0,
        last_known_address: null,
      })),
    ),
  );
});

describe("GET /api/prospects/worklist", () => {
  test("warehouse agents and investors are refused", async () => {
    as("w", "warehouse_agent", LY);
    expect((await GET(req())).status).toBe(403);
    as("i", "investor", null);
    expect((await GET(req())).status).toBe(403);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  test("an agent gets only their own prospects, whatever the query asks for", async () => {
    as("a1", "agent", LY);
    const res = await GET(req(`?agent_id=${AGENT_B}&market_id=${TN}`));
    expect(res.status).toBe(200);
    // The filters the route applied, read off the builder it used.
    const builder = mockFrom.mock.results[0].value as Record<string, ReturnType<typeof vi.fn>>;
    expect(builder.eq).toHaveBeenCalledWith("market_id", LY);
    expect(builder.eq).toHaveBeenCalledWith("assigned_to", "a1");
  });

  test("super admin must name a valid market", async () => {
    as("s", "super_admin", null);
    expect((await GET(req())).status).toBe(400);
    expect((await GET(req("?market_id=nope"))).status).toBe(400);
  });

  test("a market manager sees their own market and may narrow to one agent", async () => {
    as("m", "market_manager", LY);
    await GET(req(`?agent_id=${AGENT_B}`));
    const builder = mockFrom.mock.results[0].value as Record<string, ReturnType<typeof vi.fn>>;
    expect(builder.eq).toHaveBeenCalledWith("market_id", LY);
    expect(builder.eq).toHaveBeenCalledWith("assigned_to", AGENT_B);
  });

  test("every row comes back with the bucket the worklist rules give it", async () => {
    as("a1", "agent", LY);
    const fresh = new Date().toISOString();
    mockLeadsResult.mockReturnValue({
      data: [
        lead({ id: "hot", source: "whatsapp", created_at: fresh }),
        lead({ id: "cb", status: "callback_scheduled", callback_scheduled_at: fresh }),
        lead({ id: "camp", source: "campaign", status: "new", campaign_id: "c1" }),
      ],
      error: null,
      count: 3,
    });

    const body = await (await GET(req())).json();
    expect(body.rows.map((r: { id: string; bucket: string }) => [r.id, r.bucket])).toEqual([
      ["hot", "hot"],
      ["cb", "callback"],
      ["camp", "campaign"],
    ]);
  });

  test("the response carries the market's hot window, so the client and the server agree on what hot means", async () => {
    as("a1", "agent", LY);
    const body = await (await GET(req())).json();
    expect(body.hot_window_minutes).toBe(60);
  });

  // The catalogue column is `default_price`; `products.price` does not exist,
  // and asking PostgREST for it fails the entire request with a 42703.
  test("a product that exists is flattened onto the row; one that does not leaves the card hidden", async () => {
    as("a1", "agent", LY);
    mockLeadsResult.mockReturnValue({
      data: [
        lead({ id: "with", product_interest_id: "p1", products: { name: "Sérum", default_price: 110, image_url: "u" } }),
        lead({ id: "without" }),
      ],
      error: null,
      count: 2,
    });

    const body = await (await GET(req())).json();
    const [withProduct, withoutProduct] = body.rows;
    expect(withProduct).toMatchObject({ product_name: "Sérum", product_price: 110, product_image_url: "u" });
    expect(withoutProduct).toMatchObject({ product_name: null, product_price: null });
  });

  test("the campaign's offer and script ride along, because they are what the agent may promise", async () => {
    as("a1", "agent", LY);
    mockLeadsResult.mockReturnValue({
      data: [
        lead({
          source: "campaign", campaign_id: "c1", status: "new",
          prospect_campaigns: { name: "Sérum 60-120 j", offer: "−15 %", script_fr: "Bonjour {name}", script_ar: "مرحبا {name}" },
        }),
      ],
      error: null,
      count: 1,
    });

    const body = await (await GET(req("?locale=fr"))).json();
    expect(body.rows[0]).toMatchObject({
      campaign_name: "Sérum 60-120 j",
      campaign_offer: "−15 %",
      campaign_script: "Bonjour {name}",
    });
  });

  test("the Arabic script is served to an Arabic caller", async () => {
    as("a1", "agent", LY);
    mockLeadsResult.mockReturnValue({
      data: [lead({ source: "campaign", campaign_id: "c1", prospect_campaigns: { name: "c", offer: null, script_fr: "FR", script_ar: "AR" } })],
      error: null, count: 1,
    });
    const body = await (await GET(req("?locale=ar"))).json();
    expect(body.rows[0].campaign_script).toBe("AR");
  });

  test("a converted prospect carries the order reference the agent can look up", async () => {
    as("a1", "agent", LY);
    mockLeadsResult.mockReturnValue({
      data: [lead({ id: "won", status: "won", converted_order_id: "o1" })],
      error: null, count: 1,
    });
    mockOrdersIn.mockReturnValue({ data: [{ id: "o1", external_id: "48219" }], error: null });

    const body = await (await GET(req())).json();
    expect(body.rows[0]).toMatchObject({ bucket: "converted", converted_order_ref: "48219" });
  });

  test("customer history is attached, so the risk badge is real and not a guess", async () => {
    as("a1", "agent", LY);
    mockLeadsResult.mockReturnValue({ data: [lead()], error: null, count: 1 });
    mockEnrich.mockResolvedValue([
      { ...lead(), repeat_kind: "risk", prior_order_count: 2, prior_rejected_count: 0, prior_lead_count: 0, last_known_address: "عين زارة" },
    ]);

    const body = await (await GET(req())).json();
    expect(body.rows[0]).toMatchObject({ repeat_kind: "risk", prior_order_count: 2, last_known_address: "عين زارة" });
  });

  test("a database error is a 500 with no leaked detail", async () => {
    as("a1", "agent", LY);
    mockLeadsResult.mockReturnValue({ data: null, error: { message: "relation leads does not exist" }, count: null });
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
  });
});
