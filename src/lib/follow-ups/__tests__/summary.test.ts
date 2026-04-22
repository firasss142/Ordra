import { describe, test, expect, vi } from "vitest";
import { getFollowUpsSummary } from "../summary";

function mockSupabase(rpcReturn: { data?: unknown; error?: unknown }) {
  const rpc = vi.fn().mockResolvedValue(rpcReturn);
  // Only `.rpc()` is used by getFollowUpsSummary — other methods can be stubs.
  return { rpc } as unknown as Parameters<typeof getFollowUpsSummary>[0];
}

describe("getFollowUpsSummary", () => {
  test("fans grouped rows into status counts with zero defaults", async () => {
    const supabase = mockSupabase({
      data: [
        { status: "open", count: 12 },
        { status: "in_progress", count: 5 },
      ],
      error: null,
    });

    const result = await getFollowUpsSummary(supabase, {
      marketId: "m-tn",
      agentId: null,
      campaignId: null,
    });

    expect(result).toEqual({
      total: 17,
      open: 12,
      in_progress: 5,
      resolved: 0,
      escalated: 0,
    });
  });

  test("all statuses present sum into total", async () => {
    const supabase = mockSupabase({
      data: [
        { status: "open", count: 3 },
        { status: "in_progress", count: 2 },
        { status: "resolved", count: 10 },
        { status: "escalated", count: 1 },
      ],
      error: null,
    });

    const result = await getFollowUpsSummary(supabase, {
      marketId: "m-tn",
      agentId: null,
      campaignId: null,
    });

    expect(result).toEqual({
      total: 16,
      open: 3,
      in_progress: 2,
      resolved: 10,
      escalated: 1,
    });
  });

  test("empty dataset returns all zeros", async () => {
    const supabase = mockSupabase({ data: [], error: null });

    const result = await getFollowUpsSummary(supabase, {
      marketId: null,
      agentId: null,
      campaignId: null,
    });

    expect(result).toEqual({ total: 0, open: 0, in_progress: 0, resolved: 0, escalated: 0 });
  });

  test("calls the RPC with null filters when none supplied", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const supabase = { rpc } as unknown as Parameters<typeof getFollowUpsSummary>[0];

    await getFollowUpsSummary(supabase, {
      marketId: null,
      agentId: null,
      campaignId: null,
    });

    expect(rpc).toHaveBeenCalledWith("follow_ups_status_counts", {
      p_market_id: null,
      p_agent_id: null,
      p_campaign_id: null,
    });
  });

  test("passes filter ids through to the RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const supabase = { rpc } as unknown as Parameters<typeof getFollowUpsSummary>[0];

    await getFollowUpsSummary(supabase, {
      marketId: "m-tn",
      agentId: "u-1",
      campaignId: "c-9",
    });

    expect(rpc).toHaveBeenCalledWith("follow_ups_status_counts", {
      p_market_id: "m-tn",
      p_agent_id: "u-1",
      p_campaign_id: "c-9",
    });
  });

  test("throws when the RPC returns a non-missing error", async () => {
    const supabase = mockSupabase({
      data: null,
      error: { message: "permission denied" },
    });

    await expect(
      getFollowUpsSummary(supabase, {
        marketId: "m-tn",
        agentId: null,
        campaignId: null,
      }),
    ).rejects.toThrow(/permission denied/);
  });

  test("falls back to in-memory grouping when the RPC is missing", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: {
        message:
          "Could not find the function public.follow_ups_status_counts(p_agent_id, p_campaign_id, p_market_id) in the schema cache",
      },
    });

    const eqMock = vi.fn().mockReturnThis();
    const fromBuilder = {
      select: vi.fn().mockReturnValue({
        eq: eqMock,
        then: (resolve: (v: unknown) => unknown) =>
          resolve({
            data: [
              { status: "open" },
              { status: "open" },
              { status: "resolved" },
              { status: "escalated" },
            ],
            error: null,
          }),
      }),
    };
    // eq returns the same object so filters can chain.
    eqMock.mockReturnValue(fromBuilder.select());

    const supabase = {
      rpc,
      from: vi.fn().mockReturnValue(fromBuilder),
    } as unknown as Parameters<typeof getFollowUpsSummary>[0];

    const result = await getFollowUpsSummary(supabase, {
      marketId: "m-tn",
      agentId: null,
      campaignId: null,
    });

    expect(rpc).toHaveBeenCalledOnce();
    expect(result).toEqual({
      total: 4,
      open: 2,
      in_progress: 0,
      resolved: 1,
      escalated: 1,
    });
  });

  test("coerces string counts (bigint-as-string) into numbers", async () => {
    const supabase = mockSupabase({
      data: [
        { status: "open", count: "3" },
        { status: "resolved", count: "7" },
      ],
      error: null,
    });

    const result = await getFollowUpsSummary(supabase, {
      marketId: null,
      agentId: null,
      campaignId: null,
    });

    expect(result.open).toBe(3);
    expect(result.resolved).toBe(7);
    expect(result.total).toBe(10);
  });
});
