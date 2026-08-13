import { describe, expect, it, vi } from "vitest";
import { fetchAgentCapacity } from "../agent-capacity";
import { TERMINAL_STATUSES } from "@/types/order-status";

/**
 * Minimal PostgREST stub. Every builder method records its call and returns the
 * chain; `users` and `order_history` resolve through `order`, the orders queue
 * query resolves through `then`.
 */
function client(queueRows: Array<{ assigned_to: string | null }>) {
  const orders: Record<string, ReturnType<typeof vi.fn>> = {};
  const ordersChain: Record<string, unknown> = {};
  ["select", "in", "not", "eq", "neq"].forEach((m) => {
    orders[m] = vi.fn().mockReturnValue(ordersChain);
    ordersChain[m] = orders[m];
  });
  ordersChain.then = (fn: (v: unknown) => unknown) =>
    Promise.resolve({ data: queueRows, error: null }).then(fn);

  const passthrough = (rows: unknown) => {
    const c: Record<string, unknown> = {};
    ["select", "eq", "in"].forEach((m) => { c[m] = vi.fn().mockReturnValue(c); });
    c.order = vi.fn().mockResolvedValue({ data: rows, error: null });
    return c;
  };

  return {
    orders,
    supabase: {
      from: (table: string) => {
        if (table === "orders") return ordersChain;
        if (table === "users") return passthrough([{ id: "agent-1" }]);
        return passthrough([]);
      },
    } as never,
  };
}

describe("fetchAgentCapacity", () => {
  /**
   * queue_size drives auto-assignment. Soft-deleted orders are not work — an
   * agent cannot action them — but the exclusion list omitted `deleted`, so
   * every deleted order still counted against the agent it was assigned to and
   * made them look busier than they were.
   */
  it("excludes every terminal status from queue size, deleted included", async () => {
    const { orders, supabase } = client([]);

    await fetchAgentCapacity(supabase, "m-1");

    expect(orders.not).toHaveBeenCalledWith(
      "status",
      "in",
      `(${TERMINAL_STATUSES.join(",")})`,
    );
  });

  it("counts only the orders the query returned, per agent", async () => {
    const { supabase } = client([
      { assigned_to: "agent-1" },
      { assigned_to: "agent-1" },
      { assigned_to: null },
    ]);

    const result = await fetchAgentCapacity(supabase, "m-1");

    expect(result).toEqual([
      { id: "agent-1", queue_size: 2, last_action_at: null },
    ]);
  });
});
