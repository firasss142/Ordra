import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockHandleWebhook = vi.fn();
const mockAdminFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
  createAdminClient: vi.fn(() => ({
    from: (...args: unknown[]) => mockAdminFrom(...args),
  })),
}));

vi.mock("@/lib/crypto", () => ({
  decrypt: vi.fn((s: string) => s),
}));

vi.mock("@/lib/orders/webhook-handler", () => ({
  handleWebhook: (...args: unknown[]) => mockHandleWebhook(...args),
}));

import { POST } from "./route";
import { NextRequest } from "next/server";

function makeRequest(id: string) {
  return {
    req: new NextRequest(
      new URL(`http://localhost:3000/api/admin/webhook-logs/${id}/replay`),
      { method: "POST" },
    ),
    params: { params: Promise.resolve({ id }) },
  };
}

function userChain(role: string, market_id: string | null = null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data: { role, market_id }, error: null });
  return c;
}

function logChain(payload: {
  data?: { id: string; storefront_id: string | null; status: string; payload: unknown } | null;
  error?: unknown;
}) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.maybeSingle = vi.fn().mockResolvedValue({
    data: payload.data ?? null,
    error: payload.error ?? null,
  });
  return c;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/admin/webhook-logs/[id]/replay", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const { req, params } = makeRequest("log-1");
    const res = await POST(req, params);
    expect(res.status).toBe(401);
  });

  test("returns 403 for non-super_admin", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
    mockFrom.mockImplementation((t: string) => {
      if (t === "users") return userChain("market_manager", "m-1");
      return logChain({ data: null });
    });
    const { req, params } = makeRequest("log-1");
    const res = await POST(req, params);
    expect(res.status).toBe(403);
    expect(mockHandleWebhook).not.toHaveBeenCalled();
  });

  test("returns 404 when log entry does not exist", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    mockFrom.mockImplementation((t: string) => {
      if (t === "users") return userChain("super_admin", null);
      if (t === "webhook_delivery_log") return logChain({ data: null });
      throw new Error(`unexpected table ${t}`);
    });
    const { req, params } = makeRequest("missing");
    const res = await POST(req, params);
    expect(res.status).toBe(404);
    expect(mockHandleWebhook).not.toHaveBeenCalled();
  });

  test("rejects replay of already-processed logs (status=processed)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    mockFrom.mockImplementation((t: string) => {
      if (t === "users") return userChain("super_admin", null);
      if (t === "webhook_delivery_log")
        return logChain({
          data: {
            id: "log-1",
            storefront_id: "sf-1",
            status: "processed",
            payload: { event: "order.created" },
          },
        });
      throw new Error(`unexpected table ${t}`);
    });
    const { req, params } = makeRequest("log-1");
    const res = await POST(req, params);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/only failed/i);
    expect(mockHandleWebhook).not.toHaveBeenCalled();
  });

  test("rejects replay of ignored logs", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    mockFrom.mockImplementation((t: string) => {
      if (t === "users") return userChain("super_admin", null);
      if (t === "webhook_delivery_log")
        return logChain({
          data: {
            id: "log-2",
            storefront_id: "sf-1",
            status: "ignored",
            payload: {},
          },
        });
      throw new Error(`unexpected table ${t}`);
    });
    const { req, params } = makeRequest("log-2");
    const res = await POST(req, params);
    expect(res.status).toBe(409);
    expect(mockHandleWebhook).not.toHaveBeenCalled();
  });

  test("rejects log missing storefront_id (cannot route)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    mockFrom.mockImplementation((t: string) => {
      if (t === "users") return userChain("super_admin", null);
      if (t === "webhook_delivery_log")
        return logChain({
          data: {
            id: "log-3",
            storefront_id: null,
            status: "error",
            payload: { event: "order.created" },
          },
        });
      throw new Error(`unexpected table ${t}`);
    });
    const { req, params } = makeRequest("log-3");
    const res = await POST(req, params);
    expect(res.status).toBe(422);
    expect(mockHandleWebhook).not.toHaveBeenCalled();
  });

  test("rejects log missing payload", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    mockFrom.mockImplementation((t: string) => {
      if (t === "users") return userChain("super_admin", null);
      if (t === "webhook_delivery_log")
        return logChain({
          data: {
            id: "log-4",
            storefront_id: "sf-1",
            status: "error",
            payload: null,
          },
        });
      throw new Error(`unexpected table ${t}`);
    });
    const { req, params } = makeRequest("log-4");
    const res = await POST(req, params);
    expect(res.status).toBe(422);
    expect(mockHandleWebhook).not.toHaveBeenCalled();
  });

  test("replays a failed log and invokes handler with allowReplay=true", async () => {
    const payload = { event: "order.created", order: { id: "EO-99" } };
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    mockFrom.mockImplementation((t: string) => {
      if (t === "users") return userChain("super_admin", null);
      if (t === "webhook_delivery_log")
        return logChain({
          data: {
            id: "log-5",
            storefront_id: "sf-1",
            status: "error",
            payload,
          },
        });
      throw new Error(`unexpected table ${t}`);
    });
    mockHandleWebhook.mockResolvedValue({
      status: 200,
      body: { success: true, order_id: "new-order" },
    });

    const { req, params } = makeRequest("log-5");
    const res = await POST(req, params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.replayed_log_id).toBe("log-5");
    expect(body.result).toEqual({ success: true, order_id: "new-order" });
    expect(mockHandleWebhook).toHaveBeenCalledTimes(1);

    const invocation = mockHandleWebhook.mock.calls[0][0];
    expect(invocation.allowReplay).toBe(true);
    expect(invocation.storefrontId).toBe("sf-1");
    expect(JSON.parse(invocation.rawBody)).toEqual(payload);
    // Headers passed empty — replay does not have the original signature
    expect(invocation.headers).toBeInstanceOf(Headers);
  });

  test("is idempotent: a duplicate-order result still returns 200 and does not crash", async () => {
    const payload = { event: "order.created", order: { id: "EO-99" } };
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    mockFrom.mockImplementation((t: string) => {
      if (t === "users") return userChain("super_admin", null);
      if (t === "webhook_delivery_log")
        return logChain({
          data: {
            id: "log-6",
            storefront_id: "sf-1",
            status: "error",
            payload,
          },
        });
      throw new Error(`unexpected table ${t}`);
    });
    mockHandleWebhook.mockResolvedValue({
      status: 200,
      body: { success: true, order_id: "existing-order", duplicate: true },
    });

    const { req, params } = makeRequest("log-6");
    const res = await POST(req, params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.duplicate).toBe(true);
    expect(body.result.order_id).toBe("existing-order");
  });

  test("replaying twice invokes handler twice but with identical inputs (safe repeatable)", async () => {
    const payload = { event: "order.created", order: { id: "EO-99" } };
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    mockFrom.mockImplementation((t: string) => {
      if (t === "users") return userChain("super_admin", null);
      if (t === "webhook_delivery_log")
        return logChain({
          data: {
            id: "log-7",
            storefront_id: "sf-1",
            status: "error",
            payload,
          },
        });
      throw new Error(`unexpected table ${t}`);
    });
    // First call creates, second call reports duplicate — handler provides the real idempotency
    mockHandleWebhook
      .mockResolvedValueOnce({ status: 200, body: { success: true, order_id: "new" } })
      .mockResolvedValueOnce({
        status: 200,
        body: { success: true, order_id: "new", duplicate: true },
      });

    const r1 = await POST(...Object.values(makeRequest("log-7")) as [NextRequest, { params: Promise<{ id: string }> }]);
    const r2 = await POST(...Object.values(makeRequest("log-7")) as [NextRequest, { params: Promise<{ id: string }> }]);

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect((await r1.json()).result.duplicate).toBeUndefined();
    expect((await r2.json()).result.duplicate).toBe(true);

    // Both invocations carry the same payload and allowReplay flag
    const call1 = mockHandleWebhook.mock.calls[0][0];
    const call2 = mockHandleWebhook.mock.calls[1][0];
    expect(call1.rawBody).toBe(call2.rawBody);
    expect(call1.storefrontId).toBe(call2.storefrontId);
    expect(call1.allowReplay).toBe(true);
    expect(call2.allowReplay).toBe(true);
  });
});
