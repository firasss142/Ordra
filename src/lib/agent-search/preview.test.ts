import { describe, test, expect } from "vitest";
import { makeFakeSupabase, type Row } from "@/test/helpers/fakeSupabase";
import { loadOrderPreview } from "./preview";

const ME = "agent-1";

function seed(over: { order?: Row; items?: Row[] } = {}) {
  return makeFakeSupabase({
    orders: [
      {
        id: "o2",
        market_id: "m-ly",
        external_id: "49874",
        status: "out_for_delivery",
        assigned_to: "agent-2",
        customer_name: "أحمد الورفلي",
        customer_phone: "+218913456721",
        customer_phone_2: null,
        customer_city: "طرابلس",
        customer_address: "حي الأندلس",
        product_name: "كتاب الداء والدواء",
        variant_label: null,
        quantity: 1,
        total_price: 202,
        currency: "LYD",
        carrier_id: "c-darb",
        tracking_number: "DRB-7741203",
        created_at: "2026-09-22T09:18:00Z",
        archived_at: null,
        raw_payload: { secret: true },
        unit_cost: 90,
        ...over.order,
      },
      { id: "tn-1", market_id: "m-tn", status: "pending", assigned_to: null, created_at: "2026-09-22T09:18:00Z" },
    ],
    order_items: over.items ?? [
      { id: "i1", order_id: "o2", product_name: "كتاب الداء والدواء", variant_label: "غلاف فاخر", quantity: 1, unit_price: 202, line_total: 202, created_at: "2026-09-22T09:18:00Z" },
    ],
    order_history: [
      { id: "h2", order_id: "o2", status_from: "pending", status_to: "confirmed", note: "بعد العصر", actor_id: "agent-2", actor_type: "user", created_at: "2026-09-22T10:02:00Z" },
      { id: "h1", order_id: "o2", status_from: null, status_to: "pending", note: null, actor_id: null, actor_type: "system", created_at: "2026-09-22T09:18:00Z" },
      { id: "hx", order_id: "other", status_from: null, status_to: "pending", note: "not this order", actor_id: null, actor_type: "system", created_at: "2026-09-22T09:00:00Z" },
    ],
    users: [{ id: "agent-2", full_name: "Salem Ben Ali" }],
    carriers: [{ id: "c-darb", name: "Darb Assabil" }],
  });
}

const load = (fake: ReturnType<typeof seed>, orderId: string, meId = ME) =>
  loadOrderPreview(fake.client as never, { orderId, marketId: "m-ly", meId });

describe("loadOrderPreview", () => {
  test("an order of another market does not exist for this agent", async () => {
    expect(await load(seed(), "tn-1")).toBeNull();
  });

  test("an unknown order is null, not an error", async () => {
    expect(await load(seed(), "nope")).toBeNull();
  });

  test("a colleague's order is view-only and says whose it is", async () => {
    const p = await load(seed(), "o2");
    expect(p).toMatchObject({ owner: "other", owner_name: "Salem", access: "view" });
  });

  test("the agent's own order comes back with full access, so the UI opens the real panel", async () => {
    const p = await load(seed(), "o2", "agent-2");
    expect(p).toMatchObject({ owner: "me", access: "full" });
  });

  test("lists every line of the parcel, with its variant", async () => {
    const p = await load(seed(), "o2");
    expect(p!.items).toEqual([
      { product_name: "كتاب الداء والدواء", variant_label: "غلاف فاخر", quantity: 1, line_total: 202 },
    ]);
  });

  test("an order with no order_items falls back to the line on the order itself", async () => {
    const p = await load(seed({ items: [] }), "o2");
    expect(p!.items).toEqual([
      { product_name: "كتاب الداء والدواء", variant_label: null, quantity: 1, line_total: 202 },
    ]);
  });

  test("the timeline is this order's, oldest first, signed with first names", async () => {
    const p = await load(seed(), "o2");
    expect(p!.history).toEqual([
      { status_to: "pending", created_at: "2026-09-22T09:18:00Z", note: null, actor_name: null },
      { status_to: "confirmed", created_at: "2026-09-22T10:02:00Z", note: "بعد العصر", actor_name: "Salem" },
    ]);
  });

  test("names the carrier and the tracking number", async () => {
    const p = await load(seed(), "o2");
    expect(p).toMatchObject({ carrier_name: "Darb Assabil", tracking_number: "DRB-7741203" });
  });

  test("carries nothing but what the sheet shows — no payload, no cost", async () => {
    const p = await load(seed(), "o2");
    expect(Object.keys(p!).sort()).toEqual(
      [
        "access", "archived", "carrier_name", "created_at", "currency", "customer_address",
        "customer_city", "customer_name", "customer_phone", "customer_phone_2", "external_id",
        "history", "id", "items", "owner", "owner_name", "status", "total_price", "tracking_number",
      ].sort(),
    );
  });
});
