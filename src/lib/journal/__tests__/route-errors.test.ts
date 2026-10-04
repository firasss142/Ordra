import { describe, test, expect, vi, beforeEach } from "vitest";

const recordMock = vi.fn();
vi.mock("../app-errors", async (orig) => ({
  ...(await orig<typeof import("../app-errors")>()),
  recordAppError: (...args: unknown[]) => recordMock(...args),
}));

import { withRouteErrors } from "../route-errors";
import { redact, fingerprintOf, actorFromCookieHeader } from "../app-errors";

function req(init?: RequestInit & { cookie?: string }) {
  const headers = new Headers(init?.headers);
  if (init?.cookie) headers.set("cookie", init.cookie);
  return new Request("http://localhost/api/agents/1", { method: "PATCH", ...init, headers });
}

beforeEach(() => {
  recordMock.mockReset();
  recordMock.mockResolvedValue(undefined);
});

describe("withRouteErrors", () => {
  test("a normal answer passes through untouched and is not recorded", async () => {
    const handler = vi.fn(async (_r: Request, _c?: unknown) => Response.json({ ok: true }, { status: 200 }));
    const wrapped = withRouteErrors("/api/agents/[id]", "PATCH", handler);
    const ctx = { params: { id: "1" } };
    const r = req();

    const res = await wrapped(r, ctx);

    expect(handler).toHaveBeenCalledWith(r, ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(recordMock).not.toHaveBeenCalled();
  });

  test("a 4xx is the caller's mistake, not Ordra's: not recorded", async () => {
    const wrapped = withRouteErrors("/api/x", "POST", async (_r: Request) => Response.json({ error: "Bad" }, { status: 422 }));
    await wrapped(req());
    expect(recordMock).not.toHaveBeenCalled();
  });

  test("a 500 is recorded with the route, the method, the status and the message — and still returned", async () => {
    const wrapped = withRouteErrors("/api/agents/[id]", "PATCH", async (_r: Request) =>
      Response.json({ error: "permission denied for table users", code: "42501" }, { status: 500 }),
    );

    const res = await wrapped(req());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "permission denied for table users", code: "42501" });
    expect(recordMock).toHaveBeenCalledTimes(1);
    expect(recordMock.mock.calls[0][0]).toMatchObject({
      route: "/api/agents/[id]",
      method: "PATCH",
      status: 500,
      errorCode: "42501",
      message: "permission denied for table users",
    });
  });

  test("a thrown handler is recorded as a 500 and the error is re-thrown unchanged", async () => {
    const boom = new Error("boom");
    const wrapped = withRouteErrors("/api/x", "GET", async (_r: Request) => {
      throw boom;
    });

    await expect(wrapped(req())).rejects.toBe(boom);
    expect(recordMock.mock.calls[0][0]).toMatchObject({ route: "/api/x", method: "GET", status: 500, message: "boom" });
  });

  test("a recorder that fails never changes the answer", async () => {
    recordMock.mockRejectedValue(new Error("db down"));
    const wrapped = withRouteErrors("/api/x", "GET", async (_r: Request) => Response.json({ error: "x" }, { status: 503 }));
    const res = await wrapped(req());
    expect(res.status).toBe(503);
  });

  test("a non-JSON 500 body is recorded without a message", async () => {
    const wrapped = withRouteErrors("/api/x", "GET", async (_r: Request) => new Response("<html>oops</html>", { status: 502 }));
    const res = await wrapped(req());
    expect(res.status).toBe(502);
    expect(await res.text()).toBe("<html>oops</html>");
    expect(recordMock.mock.calls[0][0]).toMatchObject({ status: 502, message: null });
  });

  test("the signed-in user is attached when the session cookie names one", async () => {
    const payload = Buffer.from(JSON.stringify({ sub: "11111111-2222-4333-8444-555555555555" })).toString("base64url");
    const session = "base64-" + Buffer.from(JSON.stringify({ access_token: `h.${payload}.s` })).toString("base64");
    const wrapped = withRouteErrors("/api/x", "GET", async (_r: Request) => Response.json({}, { status: 500 }));
    await wrapped(req({ cookie: `sb-abc-auth-token=${session}` }));
    expect(recordMock.mock.calls[0][0].actorId).toBe("11111111-2222-4333-8444-555555555555");
  });
});

describe("redact", () => {
  test("phone numbers, e-mails and long tokens never reach the journal", () => {
    expect(redact("client 0912345678 a écrit")).toBe("client ••• a écrit");
    expect(redact("from admin@oms.local")).toBe("from •••");
    expect(redact("token kassanXyZ1234567890abcdefghijklmnopq invalid")).toBe("token ••• invalid");
  });

  test("a long message is cut to 200 characters", () => {
    expect(redact("a ".repeat(300))!.length).toBeLessThanOrEqual(200);
  });

  test("null stays null", () => {
    expect(redact(null)).toBeNull();
  });
});

describe("fingerprintOf", () => {
  test("one fingerprint per route, method, status and code — never per message", () => {
    expect(fingerprintOf({ route: "/api/agents/[id]", method: "PATCH", status: 500, errorCode: "42501" })).toBe(
      "PATCH /api/agents/[id] 500 42501",
    );
    expect(fingerprintOf({ route: "/api/x", method: "GET", status: 500, errorCode: null })).toBe("GET /api/x 500");
  });
});

describe("actorFromCookieHeader", () => {
  test("no cookie, no actor", () => {
    expect(actorFromCookieHeader(null)).toBeNull();
    expect(actorFromCookieHeader("other=1")).toBeNull();
  });

  test("a chunked session cookie is reassembled", () => {
    const payload = Buffer.from(JSON.stringify({ sub: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" })).toString("base64url");
    const full = "base64-" + Buffer.from(JSON.stringify({ access_token: `h.${payload}.s` })).toString("base64");
    const half = Math.floor(full.length / 2);
    const header = `sb-x-auth-token.0=${full.slice(0, half)}; sb-x-auth-token.1=${full.slice(half)}`;
    expect(actorFromCookieHeader(header)).toBe("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
  });

  test("garbage is ignored, not thrown", () => {
    expect(actorFromCookieHeader("sb-x-auth-token=base64-!!!")).toBeNull();
  });
});
