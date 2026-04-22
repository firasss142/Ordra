import { describe, test, expect, vi } from "vitest";
import { getLeadsMetrics } from "./metrics";
import type { LeadStatus, LeadSource, LeadLostReason } from "@/types/lead";

interface MockLeadRow {
  status: LeadStatus;
  source: LeadSource;
  assigned_to: string | null;
  lost_reason: LeadLostReason | null;
  callback_scheduled_at: string | null;
}

function mockSupabase(leads: MockLeadRow[], agents: Array<{ id: string; full_name: string }> = []) {
  const fromMock = vi.fn((table: string) => {
    if (table === "leads") {
      const chain: Record<string, unknown> = {};
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.gte = vi.fn().mockReturnValue(chain);
      chain.lte = vi.fn().mockReturnValue(chain);
      chain.limit = vi.fn().mockReturnValue(chain);
      (chain as { then: unknown }).then = (
        resolve: (r: { data: MockLeadRow[]; error: null }) => void,
      ) => resolve({ data: leads, error: null });
      return chain;
    }
    if (table === "users") {
      return {
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({ data: agents, error: null }),
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  });
  return { from: fromMock } as unknown as Parameters<typeof getLeadsMetrics>[0];
}

describe("getLeadsMetrics", () => {
  test("counts byStatus across every LeadStatus", async () => {
    const rows: MockLeadRow[] = [
      row("new"),
      row("new"),
      row("assigned"),
      row("attempt_1"),
      row("callback_scheduled"),
      row("qualified"),
      row("won"),
      row("won"),
      row("lost", { lost_reason: "price" }),
      row("archived"),
    ];

    const m = await getLeadsMetrics(mockSupabase(rows), { marketId: "m1" });

    expect(m.byStatus.new).toBe(2);
    expect(m.byStatus.assigned).toBe(1);
    expect(m.byStatus.attempt_1).toBe(1);
    expect(m.byStatus.attempt_2).toBe(0);
    expect(m.byStatus.attempt_3).toBe(0);
    expect(m.byStatus.callback_scheduled).toBe(1);
    expect(m.byStatus.qualified).toBe(1);
    expect(m.byStatus.won).toBe(2);
    expect(m.byStatus.lost).toBe(1);
    expect(m.byStatus.archived).toBe(1);
    expect(m.total).toBe(10);
    expect(m.won).toBe(2);
    expect(m.lost).toBe(1);
    expect(m.overallConversionRate).toBeCloseTo(0.667, 2);
  });

  test("callbacksDueToday counts callback_scheduled with callback_scheduled_at <= end of today", async () => {
    const now = new Date("2026-04-22T10:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const rows: MockLeadRow[] = [
      // Due yesterday — counted
      row("callback_scheduled", { callback_scheduled_at: "2026-04-21T15:00:00Z" }),
      // Due later today — counted
      row("callback_scheduled", { callback_scheduled_at: "2026-04-22T20:00:00Z" }),
      // Scheduled tomorrow — NOT counted
      row("callback_scheduled", { callback_scheduled_at: "2026-04-23T09:00:00Z" }),
      // Not a callback — ignored even if date matches
      row("attempt_1", { callback_scheduled_at: "2026-04-22T08:00:00Z" }),
      // callback_scheduled with null date — NOT counted (defensive)
      row("callback_scheduled", { callback_scheduled_at: null }),
    ];

    const m = await getLeadsMetrics(mockSupabase(rows), { marketId: "m1" });

    expect(m.callbacksDueToday).toBe(2);

    vi.useRealTimers();
  });

  test("overallConversionRate is 0 when won+lost = 0 (zero-safe)", async () => {
    const m = await getLeadsMetrics(mockSupabase([row("new")]), { marketId: "m1" });
    expect(m.overallConversionRate).toBe(0);
  });

  test("passes null marketId through (super_admin cross-market)", async () => {
    const supabase = mockSupabase([]);
    await getLeadsMetrics(supabase, { marketId: null });
    // Just assert it doesn't throw; shape is covered by other tests
    expect(supabase.from).toHaveBeenCalledWith("leads");
  });

  test("preserves existing byAgent / bySource / lostReasons aggregation", async () => {
    const rows: MockLeadRow[] = [
      row("won", { source: "manual_call", assigned_to: "a1" }),
      row("won", { source: "manual_call", assigned_to: "a1" }),
      row("lost", { source: "facebook_comment", assigned_to: "a2", lost_reason: "price" }),
    ];

    const m = await getLeadsMetrics(
      mockSupabase(rows, [
        { id: "a1", full_name: "Alice" },
        { id: "a2", full_name: "Bob" },
      ]),
      { marketId: "m1" },
    );

    const a1 = m.byAgent.find((a) => a.agentId === "a1");
    expect(a1?.agentName).toBe("Alice");
    expect(a1?.won).toBe(2);

    const manual = m.bySource.find((s) => s.source === "manual_call");
    expect(manual?.won).toBe(2);

    expect(m.lostReasons.find((r) => r.reason === "price")?.count).toBe(1);
  });
});

function row(
  status: LeadStatus,
  overrides: Partial<MockLeadRow> = {},
): MockLeadRow {
  return {
    status,
    source: overrides.source ?? "manual_call",
    assigned_to: overrides.assigned_to ?? null,
    lost_reason: overrides.lost_reason ?? null,
    callback_scheduled_at: overrides.callback_scheduled_at ?? null,
  };
}
