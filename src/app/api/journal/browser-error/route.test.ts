import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const getActor = vi.fn();
vi.mock("@/lib/auth/actor", () => ({ getActor: (...a: unknown[]) => getActor(...a) }));
const recordAppError = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("@/lib/journal/app-errors", async (orig) => ({
  ...(await orig<typeof import("@/lib/journal/app-errors")>()),
  recordAppError: (...a: unknown[]) => recordAppError(...a),
}));

import { POST } from "./route";
import { normalisePage } from "@/lib/journal/browser-error";

const USER = "11111111-2222-4333-8444-555555555555";

function post(body: unknown) {
  return new NextRequest("http://localhost/api/journal/browser-error", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  getActor.mockReset();
  recordAppError.mockClear();
  getActor.mockResolvedValue({ actor: { id: USER, role: "agent", market_id: "m1" } });
});

describe("POST /api/journal/browser-error", () => {
  test("a crash from a signed-in user is recorded as a browser error, grouped by page and message", async () => {
    const res = await POST(
      post({
        kind: "boundary",
        name: "TypeError",
        message: "Cannot read properties of undefined (reading 'map')",
        stack: "TypeError: Cannot read…\n    at OrdersTable (webpack-internal:///./src/components/orders/OrdersTable.tsx:120:15)",
        page: "/fr/orders/6b1c2d3e-0000-4000-8000-000000000001",
      }),
    );
    expect(res.status).toBe(204);
    const row = recordAppError.mock.calls[0][0] as Record<string, unknown>;
    expect(row).toMatchObject({
      source: "browser",
      route: "/orders/[id]",
      method: "BROWSER",
      status: 0,
      actorId: USER,
      page: "/fr/orders/6b1c2d3e-0000-4000-8000-000000000001",
      message: "Cannot read properties of undefined (reading 'map')",
      cause: { kind: "code", code: "TypeError", target: "OrdersTable.tsx:120" },
    });
    expect(String(row.errorCode)).toMatch(/^TypeError:[0-9a-z]{6}$/);
  });

  test("the same message on the same page gets the same code; another message another", async () => {
    await POST(post({ name: "Error", message: "A", page: "/fr/x" }));
    await POST(post({ name: "Error", message: "A", page: "/fr/x" }));
    await POST(post({ name: "Error", message: "B", page: "/fr/x" }));
    const codes = recordAppError.mock.calls.map((c) => (c[0] as { errorCode: string }).errorCode);
    expect(codes[0]).toBe(codes[1]);
    expect(codes[2]).not.toBe(codes[0]);
  });

  test("nobody signed in → 401, nothing recorded", async () => {
    getActor.mockResolvedValue({ response: new Response(null, { status: 401 }) });
    const res = await POST(post({ message: "x", page: "/fr" }));
    expect(res.status).toBe(401);
    expect(recordAppError).not.toHaveBeenCalled();
  });

  test("noise is dropped: empty, ResizeObserver, extension scripts, cancelled fetches", async () => {
    for (const body of [
      { message: "", page: "/fr" },
      { message: "ResizeObserver loop completed with undelivered notifications.", page: "/fr" },
      { message: "x", stack: "at chrome-extension://abc/content.js:1:1", page: "/fr" },
      { name: "AbortError", message: "The user aborted a request.", page: "/fr" },
      { message: "Script error.", page: "/fr" },
    ]) {
      expect((await POST(post(body))).status).toBe(204);
    }
    expect(recordAppError).not.toHaveBeenCalled();
  });

  test("a malformed body is a 400", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/journal/browser-error", { method: "POST", body: "not json" }),
    );
    expect(res.status).toBe(400);
  });
});

describe("normalisePage", () => {
  test("drops the locale and replaces ids, so one crash is one problem", () => {
    expect(normalisePage("/ar/orders/6b1c2d3e-0000-4000-8000-000000000001?tab=x")).toBe("/orders/[id]");
    expect(normalisePage("/fr/warehouse/scan")).toBe("/warehouse/scan");
    expect(normalisePage("/fr/products/12345/edit")).toBe("/products/[id]/edit");
    expect(normalisePage("/fr")).toBe("/");
  });
});
