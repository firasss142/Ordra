import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetActor = vi.fn();
const mockBulkDelete = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({}),
  createAdminClient: vi.fn().mockReturnValue({}),
}));

vi.mock("@/lib/auth/actor", () => ({
  getActor: (...args: unknown[]) => mockGetActor(...args),
}));

vi.mock("@/lib/orders/duplicate-bulk-delete", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/orders/duplicate-bulk-delete")
  >("@/lib/orders/duplicate-bulk-delete");
  return {
    ...actual,
    bulkDeleteDuplicateSiblings: (...a: unknown[]) => mockBulkDelete(...a),
  };
});

import { POST } from "./route";
import { NextRequest } from "next/server";

const MANAGER = { id: "mgr-1", role: "market_manager", market_id: "m-1" };
const AGENT = { id: "agent-1", role: "agent", market_id: "m-1" };
const SUPER = { id: "sa-1", role: "super_admin", market_id: null };

function createRequest(body?: unknown) {
  return new NextRequest(
    new URL("http://localhost:3000/api/orders/bulk-delete-duplicates"),
    {
      method: "POST",
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
  );
}

const ONE_PAIR = { pairs: [{ anchor_id: "a-1", sibling_id: "s-1" }] };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActor.mockResolvedValue({ actor: MANAGER });
  mockBulkDelete.mockResolvedValue({ succeeded: [{ order_id: "s-1" }], failed: [] });
});

describe("POST /api/orders/bulk-delete-duplicates", () => {
  test("returns 401 when unauthenticated", async () => {
    mockGetActor.mockResolvedValue({
      response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    });
    const res = await POST(createRequest(ONE_PAIR));
    expect(res.status).toBe(401);
    expect(mockBulkDelete).not.toHaveBeenCalled();
  });

  /**
   * The screen is read-only for agents. That is a UI decision, and a UI
   * decision is not access control — the route must refuse them on its own.
   */
  test("returns 403 for an agent, regardless of what the UI shows", async () => {
    mockGetActor.mockResolvedValue({ actor: AGENT });
    const res = await POST(createRequest(ONE_PAIR));
    expect(res.status).toBe(403);
    expect(mockBulkDelete).not.toHaveBeenCalled();
  });

  test("allows a market_manager", async () => {
    const res = await POST(createRequest(ONE_PAIR));
    expect(res.status).toBe(200);
    expect(mockBulkDelete).toHaveBeenCalledTimes(1);
  });

  test("allows a super_admin", async () => {
    mockGetActor.mockResolvedValue({ actor: SUPER });
    const res = await POST(createRequest(ONE_PAIR));
    expect(res.status).toBe(200);
  });

  test("returns 400 on invalid JSON", async () => {
    const bad = new NextRequest(
      new URL("http://localhost:3000/api/orders/bulk-delete-duplicates"),
      { method: "POST", body: "{not json" },
    );
    const res = await POST(bad);
    expect(res.status).toBe(400);
    expect(mockBulkDelete).not.toHaveBeenCalled();
  });

  test("returns 400 when pairs is missing or empty", async () => {
    expect((await POST(createRequest({}))).status).toBe(400);
    expect((await POST(createRequest({ pairs: [] }))).status).toBe(400);
    expect(mockBulkDelete).not.toHaveBeenCalled();
  });

  test("returns 400 when a pair is malformed", async () => {
    const res = await POST(createRequest({ pairs: [{ anchor_id: "a" }] }));
    expect(res.status).toBe(400);
    expect(mockBulkDelete).not.toHaveBeenCalled();
  });

  test("returns 400 when a pair points at itself", async () => {
    const res = await POST(
      createRequest({ pairs: [{ anchor_id: "same", sibling_id: "same" }] }),
    );
    expect(res.status).toBe(400);
    expect(mockBulkDelete).not.toHaveBeenCalled();
  });

  test("rejects a batch larger than the cap", async () => {
    const pairs = Array.from({ length: 101 }, (_, i) => ({
      anchor_id: "a",
      sibling_id: `s-${i}`,
    }));
    const res = await POST(createRequest({ pairs }));
    expect(res.status).toBe(400);
    expect(mockBulkDelete).not.toHaveBeenCalled();
  });

  test("reports partial success as 200 with both arrays", async () => {
    mockBulkDelete.mockResolvedValue({
      succeeded: [{ order_id: "ok" }],
      failed: [{ order_id: "bad", reason: "status_not_deletable", error: "no" }],
    });
    const res = await POST(
      createRequest({
        pairs: [
          { anchor_id: "a", sibling_id: "ok" },
          { anchor_id: "a", sibling_id: "bad" },
        ],
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.succeeded).toEqual([{ order_id: "ok" }]);
    expect(json.data.failed[0].reason).toBe("status_not_deletable");
  });

  test("passes the actor through to the delete gate", async () => {
    await POST(createRequest(ONE_PAIR));
    expect(mockBulkDelete.mock.calls[0][2]).toMatchObject({
      pairs: [{ anchor_id: "a-1", sibling_id: "s-1" }],
      actor: MANAGER,
    });
  });
});
