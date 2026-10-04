import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { enrichRowsWithCustomerHistory } from "./enrich";

describe("enrichRowsWithCustomerHistory", () => {
  it("carries the delivered and returned history the row tags read", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          source_id: "o1",
          prior_order_count: 4,
          prior_lead_count: 0,
          prior_delivered_count: 3,
          prior_returned_count: 1,
          prior_rejected_count: 0,
          phone_matched: true,
          last_known_address: null,
        },
      ],
      error: null,
    });
    const [row] = await enrichRowsWithCustomerHistory({ rpc } as unknown as SupabaseClient, "m", "order", [
      { id: "o1", customer_phone: "0912345678" },
    ]);
    expect(row.prior_delivered_count).toBe(3);
    expect(row.prior_returned_count).toBe(1);
  });

  it("an unknown customer has no history", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const [row] = await enrichRowsWithCustomerHistory({ rpc } as unknown as SupabaseClient, "m", "order", [{ id: "o1" }]);
    expect(row.prior_delivered_count).toBe(0);
    expect(row.prior_returned_count).toBe(0);
  });
});
