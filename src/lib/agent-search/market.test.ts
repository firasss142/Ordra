import { describe, test, expect } from "vitest";
import { makeFakeSupabase, spyFrom, type Row } from "@/test/helpers/fakeSupabase";
import {
  MARKET_SEARCH_LIMIT,
  MARKET_SEARCH_SELECT,
  rankMarketRows,
  searchMarketOrders,
} from "./market";

const ME = "agent-1";

function order(id: string, over: Row = {}): Row {
  return {
    id,
    market_id: "m-ly",
    external_id: id.toUpperCase(),
    status: "pending",
    assigned_to: null,
    customer_name: "Client",
    customer_phone: null,
    customer_phone_2: null,
    customer_city: "طرابلس",
    customer_address: null,
    product_name: "مصحف",
    variant_label: null,
    total_price: 200,
    currency: "LYD",
    tracking_number: null,
    created_at: "2026-09-20T10:00:00Z",
    archived_at: null,
    raw_payload: { secret: true },
    ...over,
  };
}

// One customer, written three ways by three storefronts, held by three owners —
// plus the same number in the OTHER market, which must never come back.
function seed() {
  const fake = makeFakeSupabase({
    orders: [
      order("o1", { assigned_to: ME, customer_name: "أحمد الورفلي", customer_phone: "0913456721", status: "attempt_1", created_at: "2026-10-01T10:42:00Z" }),
      order("o2", { assigned_to: "agent-2", customer_name: "أحمد الورفلي", customer_phone: "+218913456721", status: "out_for_delivery", created_at: "2026-09-22T09:18:00Z", tracking_number: "DRB-7741203" }),
      order("o3", { customer_name: "احمد الورفلي", customer_phone: "913456721", status: "deleted", created_at: "2026-09-22T09:11:00Z" }),
      order("o4", { customer_name: "أحمد الفيتوري", customer_phone: "0945507781", status: "pending", created_at: "2026-10-01T11:58:00Z" }),
      order("o5", { market_id: "m-tn", assigned_to: "agent-9", customer_name: "أحمد", customer_phone: "0913456721" }),
    ],
    users: [
      { id: "agent-2", full_name: "Salem Ben Ali" },
      { id: "agent-9", full_name: "Other Market" },
    ],
  });
  return fake;
}

const run = (fake: ReturnType<typeof seed>, raw: string, extra: { showOthers?: boolean } = {}) =>
  searchMarketOrders(fake.client as never, { marketId: "m-ly", meId: ME, raw, ...extra });

describe("searchMarketOrders", () => {
  test("finds one customer under all three stored phone formats, in the agent's market only", async () => {
    const { rows } = await run(seed(), "091 345 67");
    expect(rows.map((r) => r.id).sort()).toEqual(["o1", "o2", "o3"]);
  });

  test("never returns another market's order, even on an exact phone match", async () => {
    const { rows } = await run(seed(), "0913456721");
    expect(rows.map((r) => r.id)).not.toContain("o5");
  });

  test("says who owns each row and what the agent may do with it", async () => {
    const { rows } = await run(seed(), "0913456721");
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId.o1).toMatchObject({ owner: "me", access: "full", owner_name: null });
    // First name only: the agent needs to know whom to hand the caller to.
    expect(byId.o2).toMatchObject({ owner: "other", access: "view", owner_name: "Salem" });
    expect(byId.o3).toMatchObject({ owner: "none", access: "view", owner_name: null });
  });

  test("finds every Arabic spelling of a name", async () => {
    const { rows } = await run(seed(), "احمد");
    expect(rows.map((r) => r.id).sort()).toEqual(["o1", "o2", "o3", "o4"]);
  });

  test("ranks the agent's own first, then open orders newest first, deleted last", async () => {
    const { rows } = await run(seed(), "احمد");
    expect(rows.map((r) => r.id)).toEqual(["o1", "o4", "o2", "o3"]);
  });

  test("hides other agents' orders when the market rule says so (decision D1)", async () => {
    const { rows } = await run(seed(), "احمد", { showOthers: false });
    expect(rows.map((r) => r.id).sort()).toEqual(["o1", "o3", "o4"]);
  });

  test("returns at most the display limit, and the true total alongside", async () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      order(`n${i}`, { customer_name: `Salima ${i}`, created_at: `2026-09-${10 + i}T10:00:00Z` }),
    );
    const fake = makeFakeSupabase({ orders: many, users: [] });
    const { rows, total } = await run(fake, "salima");
    expect(rows).toHaveLength(MARKET_SEARCH_LIMIT);
    expect(total).toBe(12);
  });

  test("a query too short to be precise costs no request at all", async () => {
    const fake = seed();
    const from = spyFrom(fake);
    expect(await run(fake, "ah")).toEqual({ rows: [], total: 0 });
    expect(from).not.toHaveBeenCalled();
  });

  test("never hands the browser the webhook payload or any column it did not name", async () => {
    expect(MARKET_SEARCH_SELECT).not.toMatch(/\*|raw_payload|cost|margin/);
    const { rows } = await run(seed(), "0913456721");
    for (const r of rows) expect(r).not.toHaveProperty("raw_payload");
  });
});

describe("rankMarketRows", () => {
  const base = { status: "pending", created_at: "2026-09-01T00:00:00Z", customer_phone: null, customer_phone_2: null, external_id: null, tracking_number: null, assigned_to: null };

  test("an exact phone match outranks the agent's own partial match", () => {
    const rows = [
      { ...base, id: "mine-partial", assigned_to: ME, customer_phone_2: "20945507781" },
      { ...base, id: "exact-other", customer_phone: "+218945507781" },
    ];
    expect(rankMarketRows(rows, "0945507781", ME).map((r) => r.id)).toEqual(["exact-other", "mine-partial"]);
  });

  test("an exact reference or tracking number outranks a substring hit", () => {
    const rows = [
      { ...base, id: "sub", external_id: "504871", created_at: "2026-09-30T00:00:00Z" },
      { ...base, id: "exact", external_id: "50487" },
    ];
    expect(rankMarketRows(rows, "#50487", ME).map((r) => r.id)).toEqual(["exact", "sub"]);
    const tracked = [
      { ...base, id: "sub", tracking_number: "DRB-77412031" },
      { ...base, id: "exact", tracking_number: "DRB-7741203" },
    ];
    expect(rankMarketRows(tracked, "drb-7741203", ME).map((r) => r.id)).toEqual(["exact", "sub"]);
  });

  test("a deleted order stays last even when it matches exactly", () => {
    const rows = [
      { ...base, id: "deleted", status: "deleted", customer_phone: "0945507781" },
      { ...base, id: "partial", customer_phone: "09455077810" },
    ];
    expect(rankMarketRows(rows, "0945507781", ME).map((r) => r.id)).toEqual(["partial", "deleted"]);
  });
});
