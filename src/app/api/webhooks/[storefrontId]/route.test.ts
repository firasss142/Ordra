import { describe, test, expect, vi, beforeEach } from "vitest";

const mockHandleWebhook = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn(() => ({})),
}));

vi.mock("@/lib/crypto", () => ({
  decrypt: vi.fn((s: string) => s),
}));

vi.mock("@/lib/orders/webhook-handler", () => ({
  handleWebhook: (...args: unknown[]) => mockHandleWebhook(...args),
}));

import { POST, OPTIONS, GET, PUT, PATCH, DELETE } from "./route";
import { NextRequest } from "next/server";

const params = { params: Promise.resolve({ storefrontId: "store-uuid-1" }) };

function postRequest(body: string) {
  return new NextRequest(
    new URL("http://localhost:3000/api/webhooks/store-uuid-1"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { method: "POST", body } as any,
  );
}

describe("webhook route — storefront CORS", () => {
  beforeEach(() => {
    mockHandleWebhook.mockReset();
  });

  test("OPTIONS preflight returns 204 with all CORS headers", async () => {
    const res = await OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
    expect(res.headers.get("Access-Control-Allow-Headers")).toBe("Content-Type");
    expect(res.headers.get("Access-Control-Max-Age")).toBe("86400");
  });

  test("POST success response carries CORS headers and handler body", async () => {
    mockHandleWebhook.mockResolvedValueOnce({
      status: 200,
      body: { success: true, order_id: "ord-1" },
    });

    const res = await POST(postRequest("{}"), params);

    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    await expect(res.json()).resolves.toEqual({ success: true, order_id: "ord-1" });
  });

  test("POST error response (handler returns 200 with error body) still carries CORS headers", async () => {
    mockHandleWebhook.mockResolvedValueOnce({
      status: 200,
      body: { error: "Invalid webhook signature" },
    });

    const res = await POST(postRequest("{}"), params);

    expect(res.status).toBe(200);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    await expect(res.json()).resolves.toEqual({ error: "Invalid webhook signature" });
  });

  test("GET returns 405 with CORS headers", async () => {
    const res = await GET();
    expect(res.status).toBe(405);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    await expect(res.json()).resolves.toEqual({ error: "Method not allowed" });
  });

  test("PUT/PATCH/DELETE all return 405 with CORS headers", async () => {
    for (const handler of [PUT, PATCH, DELETE]) {
      const res = await handler();
      expect(res.status).toBe(405);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    }
  });
});
