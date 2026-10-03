import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { makeFakeSupabase, type FakeSupabase } from "@/test/helpers/fakeSupabase";

/**
 * GET /api/warehouse/returns — the « Rentrer » screen's data.
 *
 * Three lists for ONE building: what waits at Darb for us (`to_be_returned`,
 * the only receivable status), what is still on the road (`returning`, shown
 * greyed and never receivable), and — for the desk — what was decided in the
 * last seven days. The building filter used to be ignored here, so Benghazi saw
 * Tripoli's returns.
 */

let fake: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => fake.client),
}));
vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});

import { GET } from "./route";
import { setTestActor, resetTestActor } from "@/test/helpers/actorMock";

const LY = "00000000-0000-0000-0000-000000000002";
const BEN = "w-ben";
const TRI = "w-tri";
const DAY = 86_400_000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

function rpcRow(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    customer_name: "سعاد",
    customer_phone: "0940",
    customer_city: "طبرق",
    customer_address: null,
    product_id: "p-qr",
    product_name: "مصحف القرآن تدبر وعمل",
    variant_label: null,
    quantity: 1,
    total_price: 120,
    status: "to_be_returned",
    created_at: iso(12 * DAY),
    tracking_number: `SH${id}`,
    carrier_sticker_ref: null,
    carrier_status_slug: null,
    returned_at: iso(4 * DAY),
    ...extra,
  };
}

function seed() {
  fake = makeFakeSupabase({
    users: [
      { id: "adel", warehouse_id: BEN },
      { id: "nobody", warehouse_id: null },
    ],
    warehouses: [
      { id: BEN, market_id: LY, name_fr: "Benghazi", name_ar: "بنغازي" },
      { id: TRI, market_id: LY, name_fr: "Tripoli", name_ar: "طرابلس" },
    ],
    products: [{ id: "p-qr", image_url: null }],
    orders: [
      { id: "r-ben", market_id: LY, warehouse_id: BEN, carrier_extra: null },
      { id: "r-tri", market_id: LY, warehouse_id: TRI, carrier_extra: null },
      // Fulfilled from the carrier's own warehouse: the bench's queue stats count
      // it for every building, so the list must too or the two figures disagree.
      { id: "r-cw", market_id: LY, warehouse_id: TRI, carrier_extra: { fulfil_from_carrier_warehouse: "true" } },
      {
        id: "w-1", market_id: LY, warehouse_id: BEN, status: "returning", archived_at: null,
        product_id: "p-qr", product_name: "مصحف القرآن تدبر وعمل", variant_label: null, quantity: 1,
        customer_city: "سرت", created_at: iso(12 * DAY),
      },
      {
        id: "w-2", market_id: LY, warehouse_id: TRI, status: "returning", archived_at: null,
        product_id: "p-qr", product_name: "كتاب الداء والدواء", variant_label: null, quantity: 1,
        customer_city: "مصراتة", created_at: iso(11 * DAY),
      },
      {
        id: "w-3", market_id: LY, warehouse_id: BEN, status: "returning", archived_at: iso(DAY),
        product_id: "p-qr", product_name: "x", variant_label: null, quantity: 1,
        customer_city: "x", created_at: iso(11 * DAY),
      },
      // Decided last week, at Benghazi.
      {
        id: "d-1", market_id: LY, warehouse_id: BEN, status: "returned",
        product_id: "p-qr", product_name: "مصحف القرآن تدبر وعمل", variant_label: null, quantity: 1,
        customer_name: "هدى", customer_city: "بنغازي", tracking_number: "SH9", carrier_sticker_ref: null,
      },
      {
        id: "d-2", market_id: LY, warehouse_id: BEN, status: "received",
        product_id: "p-qr", product_name: "كتاب الداء والدواء", variant_label: null, quantity: 1,
        customer_name: "علي", customer_city: "درنة", tracking_number: "SH8", carrier_sticker_ref: null,
      },
      {
        id: "d-3", market_id: LY, warehouse_id: TRI, status: "returned",
        product_id: "p-qr", product_name: "x", variant_label: null, quantity: 1,
        customer_name: "x", customer_city: "x", tracking_number: "SH7", carrier_sticker_ref: null,
      },
      {
        id: "d-old", market_id: LY, warehouse_id: BEN, status: "returned",
        product_id: "p-qr", product_name: "x", variant_label: null, quantity: 1,
        customer_name: "x", customer_city: "x", tracking_number: "SH6", carrier_sticker_ref: null,
      },
    ],
    darb_shipments: [
      { order_id: "r-ben", remark_class: "refused", last_synced_at: iso(DAY) },
      // An older shipment of the same order (re-sent) must not win.
      { order_id: "r-ben", remark_class: "no_answer", last_synced_at: iso(9 * DAY) },
      { order_id: "r-tri", remark_class: "coordinated", last_synced_at: iso(DAY) },
    ],
    order_history: [
      { order_id: "d-1", market_id: LY, status_from: "to_be_returned", status_to: "returned", created_at: iso(2 * DAY) },
      { order_id: "d-2", market_id: LY, status_from: "to_be_returned", status_to: "received", created_at: iso(1 * DAY) },
      { order_id: "d-3", market_id: LY, status_from: "to_be_returned", status_to: "returned", created_at: iso(1 * DAY) },
      { order_id: "d-old", market_id: LY, status_from: "to_be_returned", status_to: "returned", created_at: iso(9 * DAY) },
    ],
    inventory_log: [
      { order_id: "d-1", reason: "damaged_writeoff", is_damaged: true, return_reason: "packaging" },
      { order_id: "d-3", reason: "returned", is_damaged: false, return_reason: null },
      { order_id: "d-old", reason: "returned", is_damaged: false, return_reason: null },
    ],
  });
  fake.rpcs.get_to_be_returned_orders = () => [rpcRow("r-ben"), rpcRow("r-tri", { returned_at: iso(DAY) }), rpcRow("r-cw")];
}

function req(qs = "") {
  return new NextRequest(new URL(`http://localhost/api/warehouse/returns?limit=100${qs}`));
}

beforeEach(() => {
  resetTestActor();
  seed();
});

describe("GET /api/warehouse/returns", () => {
  test("refuses a role that does not work the warehouse", async () => {
    setTestActor({ role: "agent", market_id: LY });
    expect((await GET(req())).status).toBe(403);
  });

  test("pins an agent to their own building, whatever the query says", async () => {
    setTestActor({ id: "adel", role: "warehouse_agent", market_id: LY });
    const body = await (await GET(req(`&warehouse_id=${TRI}`))).json();
    expect(body.orders.map((o: { id: string }) => o.id)).toEqual(["r-ben", "r-cw"]);
    expect(body.onTheWay.map((o: { id: string }) => o.id)).toEqual(["w-1"]);
  });

  test("an agent with no building sees nothing, and is told why", async () => {
    setTestActor({ id: "nobody", role: "warehouse_agent", market_id: LY });
    const body = await (await GET(req())).json();
    expect(body.siteUnassigned).toBe(true);
    expect(body.orders).toEqual([]);
    expect(body.onTheWay).toEqual([]);
  });

  test("a manager narrows to the building the desk switch chose", async () => {
    setTestActor({ id: "mm", role: "market_manager", market_id: LY });
    const body = await (await GET(req(`&warehouse_id=${TRI}`))).json();
    expect(body.orders.map((o: { id: string }) => o.id)).toEqual(["r-tri", "r-cw"]);
    expect(body.onTheWay.map((o: { id: string }) => o.id)).toEqual(["w-2"]);
  });

  test("a manager with no building chosen sees every building", async () => {
    setTestActor({ id: "mm", role: "market_manager", market_id: LY });
    const body = await (await GET(req())).json();
    expect(body.orders).toHaveLength(3);
    // Archived parcels are not on the road any more.
    expect(body.onTheWay.map((o: { id: string }) => o.id)).toEqual(["w-1", "w-2"]);
  });

  test("names each row's building in the market's language", async () => {
    setTestActor({ id: "mm", role: "market_manager", market_id: LY });
    const body = await (await GET(req())).json();
    const ben = body.orders.find((o: { id: string }) => o.id === "r-ben");
    expect(ben.warehouse_name).toBe("بنغازي");
    expect(body.onTheWay[1].warehouse_name).toBe("طرابلس");
  });

  test("carries the Darb reason from the most recent shipment, and only a reason that explains a return", async () => {
    setTestActor({ id: "mm", role: "market_manager", market_id: LY });
    const body = await (await GET(req())).json();
    const by = Object.fromEntries(body.orders.map((o: { id: string; darb_reason: string | null }) => [o.id, o.darb_reason]));
    expect(by["r-ben"]).toBe("refused");
    // « coordinated » is a delivery note, not why a parcel came back.
    expect(by["r-tri"]).toBeNull();
    expect(by["r-cw"]).toBeNull();
  });

  test("keeps « chez Darb depuis » = when it became to_be_returned, not when it was ordered", async () => {
    setTestActor({ id: "mm", role: "market_manager", market_id: LY });
    const body = await (await GET(req())).json();
    const tri = body.orders.find((o: { id: string }) => o.id === "r-tri");
    expect(Date.now() - new Date(tri.returned_at).getTime()).toBeLessThan(2 * DAY);
  });

  test("lists the last seven days' decisions for the desk, newest first, with their outcome", async () => {
    setTestActor({ id: "mm", role: "market_manager", market_id: LY });
    const body = await (await GET(req(`&warehouse_id=${BEN}`))).json();
    expect(body.processed.map((p: { id: string; outcome: string }) => [p.id, p.outcome])).toEqual([
      ["d-2", "redelivered"],
      ["d-1", "damaged"],
    ]);
    expect(body.processed[1].return_reason).toBe("packaging");
  });

  test("does not compute the desk's history for the agent's phone", async () => {
    setTestActor({ id: "adel", role: "warehouse_agent", market_id: LY });
    const body = await (await GET(req())).json();
    expect(body.processed).toEqual([]);
  });

  test("a failed queue read is a 500, not an empty list", async () => {
    setTestActor({ id: "mm", role: "market_manager", market_id: LY });
    fake.rpcs.get_to_be_returned_orders = () => {
      throw new Error("boom");
    };
    expect((await GET(req())).status).toBe(500);
  });
});
