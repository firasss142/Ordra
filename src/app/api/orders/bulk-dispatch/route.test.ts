import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetActor = vi.fn();
const mockPerformDispatch = vi.fn();

vi.mock("@/lib/auth/actor", () => ({
  getActor: (...args: unknown[]) => mockGetActor(...args),
}));

vi.mock("@/lib/carriers/perform-dispatch", () => ({
  performDispatch: (...args: unknown[]) => mockPerformDispatch(...args),
}));

import { POST } from "./route";
import { NextRequest } from "next/server";
import { NextResponse } from "next/server";

function req(body: unknown): NextRequest {
  return new NextRequest(new URL("http://localhost/api/orders/bulk-dispatch"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActor.mockResolvedValue({
    actor: { id: "mgr-1", role: "market_manager", market_id: "m-1" },
  });
});

describe("POST /api/orders/bulk-dispatch", () => {
  test("401 when unauthenticated", async () => {
    mockGetActor.mockResolvedValueOnce({
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await POST(req({ order_ids: ["o-1"], carrier_id: "c-1" }));
    expect(res.status).toBe(401);
  });

  test("400 when order_ids missing or empty", async () => {
    const r1 = await POST(req({ carrier_id: "c-1" }));
    expect(r1.status).toBe(400);
    const r2 = await POST(req({ order_ids: [], carrier_id: "c-1" }));
    expect(r2.status).toBe(400);
  });

  test("400 when carrier_id missing", async () => {
    const res = await POST(req({ order_ids: ["o-1"] }));
    expect(res.status).toBe(400);
  });

  test("403 when actor is an agent", async () => {
    mockGetActor.mockResolvedValueOnce({
      actor: { id: "agent-1", role: "agent", market_id: "m-1" },
    });
    const res = await POST(req({ order_ids: ["o-1"], carrier_id: "c-1" }));
    expect(res.status).toBe(403);
  });

  test("400 when more than 200 order_ids submitted", async () => {
    const ids = Array.from({ length: 201 }, (_, i) => `o-${i}`);
    const res = await POST(req({ order_ids: ids, carrier_id: "c-1" }));
    expect(res.status).toBe(400);
  });

  test("dispatches each order sequentially and returns succeeded / failed buckets", async () => {
    mockPerformDispatch
      .mockResolvedValueOnce({ ok: true, trackingNumber: "T-1" })
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        error: "bad city",
        errorCode: "NAVEX_VALIDATION",
      })
      .mockResolvedValueOnce({ ok: true, trackingNumber: "T-3" });

    const res = await POST(
      req({ order_ids: ["o-1", "o-2", "o-3"], carrier_id: "c-1" }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.succeeded).toEqual([
      { order_id: "o-1", tracking_number: "T-1" },
      { order_id: "o-3", tracking_number: "T-3" },
    ]);
    expect(json.failed).toEqual([
      {
        order_id: "o-2",
        error: "bad city",
        errorCode: "NAVEX_VALIDATION",
      },
    ]);
    expect(mockPerformDispatch).toHaveBeenCalledTimes(3);
  });

  test("surfaces cross-market carrier mismatch in failed bucket without aborting batch", async () => {
    mockPerformDispatch
      .mockResolvedValueOnce({ ok: true, trackingNumber: "T-1" })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        error: "Carrier does not belong to the order's market",
      });

    const res = await POST(
      req({ order_ids: ["o-1", "o-2"], carrier_id: "c-1" }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.succeeded).toEqual([
      { order_id: "o-1", tracking_number: "T-1" },
    ]);
    expect(json.failed).toEqual([
      {
        order_id: "o-2",
        error: "Carrier does not belong to the order's market",
      },
    ]);
  });

  test("passes actor_id and carrier_id to performDispatch", async () => {
    mockPerformDispatch.mockResolvedValue({ ok: true, trackingNumber: "T" });
    await POST(req({ order_ids: ["o-1"], carrier_id: "c-9" }));
    expect(mockPerformDispatch).toHaveBeenCalledWith({
      orderId: "o-1",
      carrierId: "c-9",
      actorId: "mgr-1",
      extra: undefined,
    });
  });
});
