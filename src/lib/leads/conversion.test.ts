import { describe, test, expect, vi } from "vitest";
import { convertLeadToOrder } from "./conversion";

function mockSupabase(rpcResult: { data: unknown; error: unknown }) {
  return {
    rpc: vi.fn().mockResolvedValue(rpcResult),
  } as unknown as Parameters<typeof convertLeadToOrder>[0];
}

const baseOrderData = {
  product_id: "prod-1",
  product_name: "Widget",
  variant_label: "Small",
  quantity: 2,
  unit_price: 50,
  total_price: 100,
  customer_name: "Test User",
  customer_phone: "+21612345678",
  customer_address: "Main St",
  customer_city: "Tunis",
  customer_note: null,
};

describe("convertLeadToOrder", () => {
  test("calls convert_lead_to_order RPC with all required params", async () => {
    const supabase = mockSupabase({
      data: {
        lead_id: "lead-1",
        order_id: "order-new-1",
        lead_status: "won",
        order_status: "confirmed",
        lead_history_id: "lh-1",
        order_history_id: "oh-1",
      },
      error: null,
    });

    const result = await convertLeadToOrder(supabase, {
      leadId: "lead-1",
      actorId: "agent-1",
      order: baseOrderData,
    });

    expect(supabase.rpc).toHaveBeenCalledWith(
      "convert_lead_to_order",
      expect.objectContaining({
        p_lead_id: "lead-1",
        p_actor_id: "agent-1",
        p_product_id: "prod-1",
        p_product_name: "Widget",
        p_variant_label: "Small",
        p_quantity: 2,
        p_unit_price: 50,
        p_total_price: 100,
        p_customer_name: "Test User",
        p_customer_phone: "+21612345678",
        p_customer_address: "Main St",
        p_customer_city: "Tunis",
      })
    );

    expect(result).toEqual({
      leadId: "lead-1",
      orderId: "order-new-1",
      leadStatus: "won",
      orderStatus: "confirmed",
      leadHistoryId: "lh-1",
      orderHistoryId: "oh-1",
    });
  });

  test("rejects when quantity is zero or negative", async () => {
    const supabase = mockSupabase({ data: null, error: null });

    await expect(
      convertLeadToOrder(supabase, {
        leadId: "lead-1",
        actorId: "agent-1",
        order: { ...baseOrderData, quantity: 0 },
      })
    ).rejects.toThrow("quantity must be positive");

    await expect(
      convertLeadToOrder(supabase, {
        leadId: "lead-1",
        actorId: "agent-1",
        order: { ...baseOrderData, quantity: -1 },
      })
    ).rejects.toThrow("quantity must be positive");

    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  test("rejects when total_price is negative", async () => {
    const supabase = mockSupabase({ data: null, error: null });

    await expect(
      convertLeadToOrder(supabase, {
        leadId: "lead-1",
        actorId: "agent-1",
        order: { ...baseOrderData, total_price: -5 },
      })
    ).rejects.toThrow("total_price must be non-negative");

    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  test("propagates RPC error (lead not qualified)", async () => {
    const supabase = mockSupabase({
      data: null,
      error: { message: "lead must be in status 'qualified' to convert" },
    });

    await expect(
      convertLeadToOrder(supabase, {
        leadId: "lead-1",
        actorId: "agent-1",
        order: baseOrderData,
      })
    ).rejects.toThrow("must be in status 'qualified'");
  });

  test("propagates RPC error (already converted)", async () => {
    const supabase = mockSupabase({
      data: null,
      error: { message: "lead already converted" },
    });

    await expect(
      convertLeadToOrder(supabase, {
        leadId: "lead-1",
        actorId: "agent-1",
        order: baseOrderData,
      })
    ).rejects.toThrow("already converted");
  });

  test("allows null product_id with free-text product_name", async () => {
    const supabase = mockSupabase({
      data: {
        lead_id: "lead-1",
        order_id: "order-new-1",
        lead_status: "won",
        order_status: "confirmed",
        lead_history_id: "lh-1",
        order_history_id: "oh-1",
      },
      error: null,
    });

    await convertLeadToOrder(supabase, {
      leadId: "lead-1",
      actorId: "agent-1",
      order: {
        ...baseOrderData,
        product_id: null,
        product_name: "Custom item",
      },
    });

    expect(supabase.rpc).toHaveBeenCalledWith(
      "convert_lead_to_order",
      expect.objectContaining({
        p_product_id: null,
        p_product_name: "Custom item",
      })
    );
  });
});
