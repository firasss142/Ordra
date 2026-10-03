import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

const mockRpc = vi.fn();
let orderRow: Record<string, unknown> = { dexpress_state_id: null, darb_destination_id: null };
let carrierCode = "navex";

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(() => ({
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (table: string) => {
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.single = () =>
        Promise.resolve({
          data: table === "orders" ? orderRow : table === "carriers" ? { code: carrierCode } : null,
          error: null,
        });
      return c;
    },
  })),
}));

const mockPerformDispatch = vi.fn();
vi.mock("@/lib/carriers/perform-dispatch", () => ({
  performDispatch: (...args: unknown[]) => mockPerformDispatch(...args),
}));

const mockFinish = vi.fn();
const mockStartJobRun = vi.fn();
vi.mock("@/lib/journal/job-run", () => ({
  startJobRun: (...args: unknown[]) => mockStartJobRun(...args),
}));

import { POST } from "./route";
import { NextRequest } from "next/server";

function cronReq(secret = "s3cret") {
  return new NextRequest(new URL("http://localhost/api/cron/dispatch-scheduled"), {
    method: "POST",
    headers: { "x-cron-secret": secret },
  });
}

function ready(...ids: string[]) {
  return { data: ids.map((id) => ({ order_id: id, carrier_id: "c-1", scheduled_at: "" })), error: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "s3cret");
  orderRow = { dexpress_state_id: null, darb_destination_id: null };
  carrierCode = "navex";
  mockFinish.mockResolvedValue(undefined);
  mockStartJobRun.mockResolvedValue({ finish: mockFinish });
  mockRpc.mockResolvedValue(ready());
  mockPerformDispatch.mockResolvedValue({ ok: true, trackingNumber: "T", dispatchData: {} });
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/cron/dispatch-scheduled — the run is written to job_runs", () => {
  test("an unauthorised call opens no run", async () => {
    const res = await POST(cronReq("wrong"));
    expect(res.status).toBe(401);
    expect(mockStartJobRun).not.toHaveBeenCalled();
  });

  test("nothing ready → skipped", async () => {
    const res = await POST(cronReq());
    expect(res.status).toBe(200);
    expect(mockStartJobRun).toHaveBeenCalledWith(expect.anything(), "dispatch-scheduled");
    expect(mockFinish).toHaveBeenCalledWith({
      status: "skipped",
      counters: { ready: 0, uploaded: 0, reverted: 0, failed: 0 },
      changed: 0,
      error: null,
    });
  });

  test("every order uploaded → succeeded, changed = uploads; the answer is unchanged", async () => {
    mockRpc.mockResolvedValue(ready("o-1", "o-2"));
    const res = await POST(cronReq());
    expect(await res.json()).toEqual({
      processed: 2,
      succeeded: 2,
      failed: 0,
      results: [
        { order_id: "o-1", ok: true },
        { order_id: "o-2", ok: true },
      ],
    });
    expect(mockFinish).toHaveBeenCalledWith({
      status: "succeeded",
      counters: { ready: 2, uploaded: 2, reverted: 0, failed: 0 },
      changed: 2,
      error: null,
    });
  });

  test("some uploads refused → partial, with the first refusal as the error", async () => {
    mockRpc.mockResolvedValue(ready("o-1", "o-2"));
    mockPerformDispatch
      .mockResolvedValueOnce({ ok: true, trackingNumber: "T", dispatchData: {} })
      .mockResolvedValueOnce({ ok: false, status: 422, error: "bad city" });
    await POST(cronReq());
    expect(mockFinish).toHaveBeenCalledWith({
      status: "partial",
      counters: { ready: 2, uploaded: 1, reverted: 0, failed: 1 },
      changed: 1,
      error: "upload failed: bad city",
    });
  });

  test("every upload refused → failed", async () => {
    mockRpc.mockResolvedValue(ready("o-1"));
    mockPerformDispatch.mockResolvedValue({ ok: false, status: 422, error: "bad city" });
    await POST(cronReq());
    expect(mockFinish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", changed: 0, error: "upload failed: bad city" }),
    );
  });

  test("an order sent back to confirmed for a missing destination counts as changed, not failed", async () => {
    carrierCode = "dexpress";
    mockRpc.mockImplementation((fn: string) =>
      Promise.resolve(fn === "dispatch_scheduled_ready" ? ready("o-1") : { data: null, error: null }),
    );
    await POST(cronReq());
    expect(mockFinish).toHaveBeenCalledWith({
      status: "succeeded",
      counters: { ready: 1, uploaded: 0, reverted: 1, failed: 0 },
      changed: 1,
      error: null,
    });
  });

  test("the ready list cannot be read → failed, the 500 answer unchanged", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "relation missing" } });
    const res = await POST(cronReq());
    expect(res.status).toBe(500);
    expect(mockFinish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", error: expect.stringContaining("relation missing") }),
    );
  });

  test("a throw mid-run closes the run as failed, then propagates as before", async () => {
    mockRpc.mockResolvedValue(ready("o-1"));
    mockPerformDispatch.mockRejectedValue(new Error("boom"));
    await expect(POST(cronReq())).rejects.toThrow("boom");
    expect(mockFinish).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", error: "boom" }));
  });

  test("a run row that cannot be written never changes the answer", async () => {
    mockRpc.mockResolvedValue(ready("o-1"));
    mockStartJobRun.mockRejectedValue(new Error("journal down"));
    const res = await POST(cronReq());
    expect(res.status).toBe(200);
    expect((await res.json()).succeeded).toBe(1);
  });

  test("a finish that rejects never changes the answer", async () => {
    mockRpc.mockResolvedValue(ready("o-1"));
    mockFinish.mockRejectedValue(new Error("journal down"));
    const res = await POST(cronReq());
    expect(res.status).toBe(200);
  });
});
