import { describe, test, expect, vi, beforeEach } from "vitest";
import { monitoredFetch, failureOf } from "../external-fetch";
import { runWithCauses, currentCauses } from "../request-context";

const record = vi.fn(async (..._a: unknown[]) => undefined);
const realFetch = globalThis.fetch;

beforeEach(() => {
  record.mockClear();
  globalThis.fetch = realFetch;
});

function stubFetch(impl: () => Promise<Response>) {
  globalThis.fetch = vi.fn(impl) as unknown as typeof fetch;
}

describe("monitoredFetch — outside services", () => {
  test("a success is returned untouched and NOT recorded (polling would write 20k rows a day)", async () => {
    stubFetch(async () => Response.json({ ok: true }));
    const f = monitoredFetch("darb_assabil", "poll", { record });
    const res = await f("https://api.darb.ly/x");
    expect(await res.json()).toEqual({ ok: true });
    expect(record).not.toHaveBeenCalled();
  });

  test("a 4xx is recorded as refused, with the outside service's message", async () => {
    stubFetch(async () => new Response('{"message":"Invalid token"}', { status: 401 }));
    const f = monitoredFetch("navex", "poll", { record, connectionId: "c1" });
    const res = await f("https://app.navex.tn/api/x");
    expect(res.status).toBe(401);
    expect(await res.text()).toBe('{"message":"Invalid token"}'); // body still readable
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toMatchObject({
      system: "navex",
      operation: "poll",
      connectionId: "c1",
      status: "refused",
      httpStatus: 401,
      message: "Invalid token",
    });
  });

  test("a 5xx is recorded as error", async () => {
    stubFetch(async () => new Response("Bad gateway", { status: 502 }));
    await monitoredFetch("meta", "sync", { record })("https://graph.facebook.com/v19.0/x");
    expect(record.mock.calls[0][0]).toMatchObject({ status: "error", httpStatus: 502, message: "Bad gateway" });
  });

  test("a timeout is recorded as timeout and re-thrown", async () => {
    stubFetch(async () => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    });
    await expect(monitoredFetch("whatsapp", "send", { record })("https://graph.facebook.com/x")).rejects.toThrow();
    expect(record.mock.calls[0][0]).toMatchObject({ status: "timeout", errorCode: "timeout", httpStatus: null });
  });

  test("a network failure keeps the low-level code (ENOTFOUND, ECONNRESET…)", async () => {
    stubFetch(async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
    });
    await expect(monitoredFetch("dexpress", "upload", { record })("https://x")).rejects.toThrow("fetch failed");
    expect(record.mock.calls[0][0]).toMatchObject({ status: "error", errorCode: "ENOTFOUND" });
  });

  test("inside a request, the failure becomes the request's cause", async () => {
    stubFetch(async () => new Response("Service Unavailable", { status: 503 }));
    await runWithCauses(async () => {
      await monitoredFetch("darb_assabil", "bind", { record })("https://x");
      expect(currentCauses()[0]).toMatchObject({ kind: "external", code: "503", target: "darb_assabil" });
    });
  });

  test("a recorder that throws never breaks the caller", async () => {
    stubFetch(async () => new Response("no", { status: 500 }));
    const broken = vi.fn(async () => {
      throw new Error("db down");
    });
    const res = await monitoredFetch("navex", "poll", { record: broken })("https://x");
    expect(res.status).toBe(500);
  });
});

describe("failureOf", () => {
  test("reads the message from the usual JSON shapes, else the text", () => {
    expect(failureOf(400, '{"error":{"message":"(#100) Invalid parameter","code":100}}')).toEqual({
      status: "refused",
      errorCode: "100",
      message: "(#100) Invalid parameter",
    });
    expect(failureOf(422, '{"message":"phone invalid","code":"VALIDATION"}')).toEqual({
      status: "refused",
      errorCode: "VALIDATION",
      message: "phone invalid",
    });
    expect(failureOf(500, "<html>oops</html>")).toEqual({ status: "error", errorCode: null, message: "<html>oops</html>" });
  });

  test("429 is refused with errorCode rate_limited", () => {
    expect(failureOf(429, "")).toMatchObject({ status: "refused", errorCode: "rate_limited" });
  });
});

describe("monitoredFetch — a dead service cannot flood the journal", () => {
  test("the same failure is recorded at most once a minute per system, operation and code", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-06T10:00:00Z"));
      stubFetch(async () => new Response("down", { status: 503 }));
      const f = monitoredFetch("throttle_probe", "poll", { record });
      for (let i = 0; i < 50; i++) await f("https://x");
      expect(record).toHaveBeenCalledTimes(1);

      // another code is another failure
      stubFetch(async () => new Response("no", { status: 401 }));
      await f("https://x");
      expect(record).toHaveBeenCalledTimes(2);

      vi.setSystemTime(new Date("2026-10-06T10:01:01Z"));
      stubFetch(async () => new Response("down", { status: 503 }));
      await f("https://x");
      expect(record).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
