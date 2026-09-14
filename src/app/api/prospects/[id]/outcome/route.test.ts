import { describe, test, expect, vi, beforeEach } from "vitest";

const mockRpc = vi.fn();
const mockSingle = vi.fn();
const mockUpdateEq = vi.fn();
const mockInsert = vi.fn();

const mockFrom = vi.fn(() => ({
  select: () => ({ eq: () => ({ single: mockSingle }) }),
  update: (patch: unknown) => ({ eq: (...a: unknown[]) => mockUpdateEq(patch, ...a) }),
  insert: (rows: unknown) => mockInsert(rows),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (...a: unknown[]) => mockFrom(...(a as [])),
    rpc: (...a: unknown[]) => mockRpc(...a),
  }),
}));
vi.mock("@/lib/auth/actor", () => ({ getActor: vi.fn() }));

import { POST } from "./route";
import { getActor } from "@/lib/auth/actor";
import { NextRequest } from "next/server";

const LY = "00000000-0000-0000-0000-000000000002";
const LEAD = "11111111-2222-3333-4444-555555555555";

const post = (body: unknown, id = LEAD) =>
  POST(
    new NextRequest(new URL(`http://localhost:3000/api/prospects/${id}/outcome`), {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: { id } },
  );

const as = (id: string, role: string, market_id: string | null) =>
  vi.mocked(getActor).mockResolvedValue({ actor: { id, role, market_id } } as never);

beforeEach(() => {
  vi.clearAllMocks();
  mockSingle.mockResolvedValue({
    data: { id: LEAD, market_id: LY, status: "assigned", assigned_to: "a1" },
    error: null,
  });
  mockUpdateEq.mockResolvedValue({ error: null });
  mockInsert.mockResolvedValue({ error: null });
});

describe("POST /api/prospects/[id]/outcome", () => {
  test("a warehouse agent cannot record a call outcome", async () => {
    as("w", "warehouse_agent", LY);
    expect((await post({ kind: "no_answer" })).status).toBe(403);
  });

  test("an agent cannot record an outcome on someone else's prospect", async () => {
    as("other", "agent", LY);
    mockSingle.mockResolvedValue({ data: { id: LEAD, market_id: LY, status: "assigned", assigned_to: "a1" }, error: null });
    expect((await post({ kind: "no_answer" })).status).toBe(403);
  });

  test("a manager may record an outcome on any prospect in their market", async () => {
    as("m", "market_manager", LY);
    expect((await post({ kind: "no_answer" })).status).toBe(200);
  });

  test("a prospect in another market is refused, whatever the caller's role", async () => {
    as("m", "market_manager", "00000000-0000-0000-0000-000000000001");
    expect((await post({ kind: "no_answer" })).status).toBe(403);
  });

  test("an unknown outcome is a 400, not a silent no-op", async () => {
    as("a1", "agent", LY);
    expect((await post({ kind: "teleported" })).status).toBe(400);
  });

  test("no answer moves the prospect to the next attempt", async () => {
    as("a1", "agent", LY);
    expect((await post({ kind: "no_answer" })).status).toBe(200);
    expect(mockUpdateEq).toHaveBeenCalledWith(
      expect.objectContaining({ status: "attempt_1", callback_scheduled_at: null }),
      "id",
      LEAD,
    );
  });

  test("a fourth failed call stays at attempt_3 rather than inventing a status the enum has no room for", async () => {
    as("a1", "agent", LY);
    mockSingle.mockResolvedValue({ data: { id: LEAD, market_id: LY, status: "attempt_3", assigned_to: "a1" }, error: null });
    await post({ kind: "no_answer" });
    expect(mockUpdateEq).toHaveBeenCalledWith(expect.objectContaining({ status: "attempt_3" }), "id", LEAD);
  });

  test("a callback stores the time the customer asked for", async () => {
    as("a1", "agent", LY);
    const at = "2026-09-14T16:00:00.000Z";
    await post({ kind: "callback", at });
    expect(mockUpdateEq).toHaveBeenCalledWith(
      expect.objectContaining({ status: "callback_scheduled", callback_scheduled_at: at }),
      "id",
      LEAD,
    );
  });

  test("a callback without a time is refused, so no prospect lands in the bucket with nothing to show", async () => {
    as("a1", "agent", LY);
    expect((await post({ kind: "callback" })).status).toBe(400);
    expect((await post({ kind: "callback", at: "not-a-date" })).status).toBe(400);
  });

  test("a lost prospect records the reason it was lost", async () => {
    as("a1", "agent", LY);
    await post({ kind: "lost", reason: "price" });
    expect(mockUpdateEq).toHaveBeenCalledWith(
      expect.objectContaining({ status: "lost", lost_reason: "price" }),
      "id",
      LEAD,
    );
  });

  test("a lost reason outside the enum is refused rather than passed to Postgres", async () => {
    as("a1", "agent", LY);
    expect((await post({ kind: "lost", reason: "bored" })).status).toBe(400);
  });

  test("every outcome appends to lead_history, which is the prospect's audit trail", async () => {
    as("a1", "agent", LY);
    await post({ kind: "no_answer", note: "pas de réponse, 2e essai ce soir" });
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        lead_id: LEAD,
        status_from: "assigned",
        status_to: "attempt_1",
        actor_id: "a1",
        note: "pas de réponse, 2e essai ce soir",
      }),
    );
  });

  test("a prospect that does not exist is a 404", async () => {
    as("a1", "agent", LY);
    mockSingle.mockResolvedValue({ data: null, error: { message: "no rows" } });
    expect((await post({ kind: "no_answer" })).status).toBe(404);
  });

  test("a failed write is a 500 and appends no history", async () => {
    as("a1", "agent", LY);
    mockUpdateEq.mockResolvedValue({ error: { message: "boom" } });
    expect((await post({ kind: "no_answer" })).status).toBe(500);
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
