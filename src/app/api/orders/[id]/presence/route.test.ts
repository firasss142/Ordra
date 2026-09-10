import { describe, test, expect, vi, beforeEach } from "vitest";

const mockRpc = vi.fn();
const mockGetActor = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({ rpc: (...a: unknown[]) => mockRpc(...a) }),
}));
vi.mock("@/lib/auth/actor", () => ({ getActor: (...a: unknown[]) => mockGetActor(...a) }));

import { POST } from "./route";
import { NextResponse } from "next/server";

const SESSION = "11111111-1111-1111-1111-111111111111";
const params = Promise.resolve({ id: "order-1" });

function req(body: unknown, contentType = "application/json") {
  return new Request("http://x/api/orders/order-1/presence", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: JSON.stringify(body),
  }) as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActor.mockResolvedValue({ actor: { id: "agent-1", role: "agent", market_id: "m-1" } });
  mockRpc.mockResolvedValue({
    data: { tracked: true, expires_at: "2026-09-10T10:01:15Z", server_now: "2026-09-10T10:00:00Z", blocking_agent: null },
    error: null,
  });
});

describe("POST /api/orders/[id]/presence", () => {
  test("acquire calls acquire_order_presence with the tab's session id", async () => {
    const res = await POST(req({ action: "acquire", session_id: SESSION, mode: "viewing" }), { params });
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      "acquire_order_presence",
      expect.objectContaining({ p_order_id: "order-1", p_session_id: SESSION, p_mode: "viewing" }),
    );
  });

  test("returns server_now so the client can correct for clock skew", async () => {
    const res = await POST(req({ action: "acquire", session_id: SESSION }), { params });
    const body = await res.json();
    expect(body.data.server_now).toBe("2026-09-10T10:00:00Z");
  });

  test("heartbeat that finds no live row answers 409 lock_lost", async () => {
    mockRpc.mockResolvedValue({ data: { alive: false, expires_at: null, server_now: "x" }, error: null });
    const res = await POST(req({ action: "heartbeat", session_id: SESSION }), { params });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("lock_lost");
  });

  test("release answers 204 and writes nothing else", async () => {
    mockRpc.mockResolvedValue({ data: { released: true }, error: null });
    const res = await POST(req({ action: "release", session_id: SESSION }), { params });
    expect(res.status).toBe(204);
    expect(mockRpc).toHaveBeenCalledWith("release_order_presence", expect.any(Object));
  });

  // navigator.sendBeacon can only POST, and sends text/plain unless given a
  // typed Blob. The route must accept the body regardless of content-type.
  test("accepts a sendBeacon body sent as text/plain", async () => {
    const res = await POST(req({ action: "release", session_id: SESSION }, "text/plain"), { params });
    expect(res.status).toBe(204);
  });

  test("rejects an unknown action", async () => {
    const res = await POST(req({ action: "nope", session_id: SESSION }), { params });
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("rejects a missing session_id", async () => {
    const res = await POST(req({ action: "acquire" }), { params });
    expect(res.status).toBe(400);
  });

  test("refuses an unauthenticated call", async () => {
    mockGetActor.mockResolvedValue({ response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) });
    const res = await POST(req({ action: "acquire", session_id: SESSION }), { params });
    expect(res.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("maps a 42501 from the RPC to 403, not 500", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "42501", message: "Forbidden" } });
    const res = await POST(req({ action: "acquire", session_id: SESSION }), { params });
    expect(res.status).toBe(403);
  });
});
