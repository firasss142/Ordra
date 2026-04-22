import { describe, test, expect, vi } from "vitest";
import { searchCustomersByPhone, MIN_PHONE_SEARCH_LENGTH } from "./search";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Build a minimal mock whose .from("orders") returns a chainable builder
 * that resolves with `ordersRows`, .from("order_history") resolves with
 * `historyRows`, and .from("order_follow_ups") resolves with `existingRows`.
 */
function makeSupabase({
  ordersRows,
  historyRows,
  existingRows,
}: {
  ordersRows: unknown[];
  historyRows?: unknown[];
  existingRows?: unknown[];
}) {
  const ordersQuery = {
    select: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    then: (resolve: (v: unknown) => unknown) =>
      resolve({ data: ordersRows, error: null }),
  };

  const historyQuery = {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    then: (resolve: (v: unknown) => unknown) =>
      resolve({ data: historyRows ?? [], error: null }),
  };

  const existingQuery = {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    then: (resolve: (v: unknown) => unknown) =>
      resolve({ data: existingRows ?? [], error: null }),
  };

  const from = vi.fn((table: string) => {
    if (table === "orders") return ordersQuery;
    if (table === "order_history") return historyQuery;
    if (table === "order_follow_ups") return existingQuery;
    throw new Error(`unexpected table: ${table}`);
  });

  return { from } as unknown as SupabaseClient;
}

describe("searchCustomersByPhone", () => {
  test(`returns empty when phone is shorter than ${MIN_PHONE_SEARCH_LENGTH}`, async () => {
    const supabase = makeSupabase({ ordersRows: [] });
    const result = await searchCustomersByPhone(supabase, {
      phone: "ab",
      role: "agent",
      actorId: "agent-1",
      actorMarketId: "m-a",
    });
    expect(result).toEqual([]);
  });

  test("manager sees all post-confirmation orders in own market", async () => {
    const supabase = makeSupabase({
      ordersRows: [
        {
          id: "o-1",
          market_id: "m-a",
          customer_name: "Ali",
          customer_phone: "+2162012",
          customer_city: "Tunis",
          total_price: "120.500",
          status: "confirmed",
        },
      ],
      existingRows: [],
    });
    const result = await searchCustomersByPhone(supabase, {
      phone: "2012",
      role: "market_manager",
      actorId: "mgr-1",
      actorMarketId: "m-a",
    });
    expect(result).toEqual([
      {
        order_id: "o-1",
        customer_name: "Ali",
        customer_phone: "+2162012",
        customer_city: "Tunis",
        total_price: 120.5,
        status: "confirmed",
        has_follow_up: false,
      },
    ]);
  });

  test("agent is further restricted to orders they confirmed", async () => {
    const supabase = makeSupabase({
      ordersRows: [
        { id: "o-1", market_id: "m-a", customer_name: "Ali",   customer_phone: "+216201", customer_city: null, total_price: "100", status: "dispatched" },
        { id: "o-2", market_id: "m-a", customer_name: "Bassem", customer_phone: "+216202", customer_city: null, total_price: "200", status: "in_transit" },
      ],
      historyRows: [{ order_id: "o-1" }], // agent confirmed only o-1
      existingRows: [],
    });

    const result = await searchCustomersByPhone(supabase, {
      phone: "216",
      role: "agent",
      actorId: "agent-1",
      actorMarketId: "m-a",
    });

    expect(result.map((r) => r.order_id)).toEqual(["o-1"]);
  });

  test("marks has_follow_up for orders that already have a follow-up", async () => {
    const supabase = makeSupabase({
      ordersRows: [
        { id: "o-1", market_id: "m-a", customer_name: "Ali", customer_phone: "+21620", customer_city: null, total_price: "100", status: "confirmed" },
      ],
      existingRows: [{ order_id: "o-1" }],
    });
    const result = await searchCustomersByPhone(supabase, {
      phone: "216",
      role: "market_manager",
      actorId: "mgr",
      actorMarketId: "m-a",
    });
    expect(result[0].has_follow_up).toBe(true);
  });

  test("manager with null market_id gets empty result (safety)", async () => {
    const supabase = makeSupabase({ ordersRows: [] });
    const result = await searchCustomersByPhone(supabase, {
      phone: "216",
      role: "market_manager",
      actorId: "mgr",
      actorMarketId: null,
    });
    expect(result).toEqual([]);
  });
});
