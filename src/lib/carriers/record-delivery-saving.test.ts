import { describe, test, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordDeliverySaving } from "./record-delivery-saving";

const TRIPOLI = "4f1271c8-b1f2-4836-9293-8ab3d0b18e69";
const BENGHAZI = "43077d36-3d61-40d6-ae35-59ed15cec8f7";
const LY = "00000000-0000-0000-0000-000000000002";

const EXTRA = { city: "بنغازي", customer_area: "قمينس", service_id: "svc-1" };

interface ClientOpts {
  rates?: Array<{ carrier_id: string; shipping_amount: number | null }>;
  ratesError?: { message: string } | null;
  updateError?: { message: string } | null;
}

function makeClient(opts: ClientOpts = {}) {
  const updates: unknown[] = [];
  const rateFilters: Array<[string, unknown]> = [];

  const from = vi.fn((table: string) => {
    const chain: Record<string, unknown> = {};
    if (table === "darb_shipping_rates") {
      chain.select = vi.fn(() => chain);
      chain.eq = vi.fn((col: string, val: unknown) => {
        rateFilters.push([col, val]);
        return chain;
      });
      chain.then = (cb: (v: unknown) => unknown) =>
        Promise.resolve({ data: opts.rates ?? [], error: opts.ratesError ?? null }).then(cb);
      return chain;
    }
    if (table === "orders") {
      chain.update = vi.fn((patch: unknown) => {
        updates.push(patch);
        const tail: Record<string, unknown> = {};
        tail.eq = vi.fn(() =>
          Promise.resolve({ data: null, error: opts.updateError ?? null }),
        );
        return tail;
      });
      return chain;
    }
    throw new Error(`unexpected table ${table}`);
  });

  return { client: { from } as unknown as SupabaseClient, from, updates, rateFilters };
}

const BASE = {
  orderId: "order-1",
  carrierId: BENGHAZI,
  carrierCode: "darb_assabil",
  marketId: LY,
  extra: EXTRA as Record<string, unknown>,
};

beforeEach(() => vi.clearAllMocks());

describe("recordDeliverySaving", () => {
  test("writes the saving, the quoted cost and a timestamp", async () => {
    // Real probed بنغازي/قمينس figures: Tripoli 35, Benghazi 15.
    const { client, updates } = makeClient({
      rates: [
        { carrier_id: TRIPOLI, shipping_amount: 35 },
        { carrier_id: BENGHAZI, shipping_amount: 15 },
      ],
    });
    await recordDeliverySaving(client, BASE);

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      delivery_saving_lyd: 20,
      delivery_cost_quoted: 15,
    });
    expect((updates[0] as Record<string, string>).delivery_saving_at).toBeTruthy();
  });

  test("records a NEGATIVE saving when the dearer account was used", async () => {
    const { client, updates } = makeClient({
      rates: [
        { carrier_id: TRIPOLI, shipping_amount: 35 },
        { carrier_id: BENGHAZI, shipping_amount: 15 },
      ],
    });
    await recordDeliverySaving(client, { ...BASE, carrierId: TRIPOLI });
    expect(updates[0]).toMatchObject({ delivery_saving_lyd: -20, delivery_cost_quoted: 35 });
  });

  test("scopes the rate lookup to the destination and the order's market", async () => {
    const { client, rateFilters } = makeClient({
      rates: [
        { carrier_id: TRIPOLI, shipping_amount: 35 },
        { carrier_id: BENGHAZI, shipping_amount: 15 },
      ],
    });
    await recordDeliverySaving(client, BASE);
    expect(rateFilters).toContainEqual(["city", "بنغازي"]);
    expect(rateFilters).toContainEqual(["area", "قمينس"]);
    expect(rateFilters).toContainEqual(["carriers.market_id", LY]);
  });

  test("does nothing for a non-Darb carrier", async () => {
    const { client, from } = makeClient();
    await recordDeliverySaving(client, { ...BASE, carrierCode: "dexpress" });
    expect(from).not.toHaveBeenCalled();
  });

  test("does nothing when the dispatch extra has no destination", async () => {
    const { client, from } = makeClient();
    await recordDeliverySaving(client, { ...BASE, extra: { service_id: "s" } });
    expect(from).not.toHaveBeenCalled();
  });

  test("does nothing when extra is null", async () => {
    const { client, from } = makeClient();
    await recordDeliverySaving(client, { ...BASE, extra: null });
    expect(from).not.toHaveBeenCalled();
  });

  // Not measurable must stay NULL, never be written as a 0 that dilutes the KPI.
  test("writes nothing when only one account is priced", async () => {
    const { client, updates } = makeClient({
      rates: [{ carrier_id: BENGHAZI, shipping_amount: 15 }],
    });
    await recordDeliverySaving(client, BASE);
    expect(updates).toHaveLength(0);
  });

  test("writes nothing when the destination was never quoted", async () => {
    const { client, updates } = makeClient({ rates: [] });
    await recordDeliverySaving(client, BASE);
    expect(updates).toHaveLength(0);
  });

  test("records a measured tie as an explicit zero", async () => {
    // سبها quotes 35 from both — a real 0, distinct from "not measured".
    const { client, updates } = makeClient({
      rates: [
        { carrier_id: TRIPOLI, shipping_amount: 35 },
        { carrier_id: BENGHAZI, shipping_amount: 35 },
      ],
    });
    await recordDeliverySaving(client, BASE);
    expect(updates[0]).toMatchObject({ delivery_saving_lyd: 0 });
  });

  // The shipment already exists at the carrier by the time this runs. Nothing
  // here may throw, or a successful dispatch would surface to the agent as an error.
  test("swallows a rate-query error", async () => {
    const { client, updates } = makeClient({ ratesError: { message: "boom" } });
    await expect(recordDeliverySaving(client, BASE)).resolves.toBeUndefined();
    expect(updates).toHaveLength(0);
  });

  test("swallows an update error", async () => {
    const { client } = makeClient({
      rates: [
        { carrier_id: TRIPOLI, shipping_amount: 35 },
        { carrier_id: BENGHAZI, shipping_amount: 15 },
      ],
      updateError: { message: "denied" },
    });
    await expect(recordDeliverySaving(client, BASE)).resolves.toBeUndefined();
  });

  test("swallows a thrown client error", async () => {
    const client = {
      from: () => {
        throw new Error("connection reset");
      },
    } as unknown as SupabaseClient;
    await expect(recordDeliverySaving(client, BASE)).resolves.toBeUndefined();
  });
});
