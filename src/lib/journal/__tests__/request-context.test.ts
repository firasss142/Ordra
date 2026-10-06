import { describe, test, expect, vi } from "vitest";
import {
  runWithCauses,
  noteCause,
  currentCauses,
  pickCause,
  capturingFetch,
  installConsoleCapture,
} from "../request-context";

describe("request causes", () => {
  test("outside a request, noting a cause is a silent no-op", () => {
    expect(() => noteCause({ kind: "code", code: null, detail: "x", target: null })).not.toThrow();
    expect(currentCauses()).toEqual([]);
  });

  test("each request keeps its own causes, even when they interleave", async () => {
    const a = runWithCauses(async () => {
      noteCause({ kind: "code", code: null, detail: "a", target: null });
      await new Promise((r) => setTimeout(r, 5));
      return currentCauses().map((c) => c.detail);
    });
    const b = runWithCauses(async () => {
      noteCause({ kind: "code", code: null, detail: "b", target: null });
      return currentCauses().map((c) => c.detail);
    });
    expect(await a).toEqual(["a"]);
    expect(await b).toEqual(["b"]);
  });

  test("a request keeps at most 10 causes", () => {
    runWithCauses(() => {
      for (let i = 0; i < 30; i++) noteCause({ kind: "code", code: null, detail: String(i), target: null });
      expect(currentCauses()).toHaveLength(10);
    });
  });
});

describe("pickCause", () => {
  test("a database error beats an outside error, which beats a logged message", () => {
    const code = { kind: "code" as const, code: null, detail: "boom", target: null };
    const ext = { kind: "external" as const, code: "503", detail: "down", target: "darb_assabil" };
    const db = { kind: "db" as const, code: "22P02", detail: "invalid uuid", target: "cities" };
    expect(pickCause([code, ext, db])).toEqual(db);
    expect(pickCause([code, ext])).toEqual(ext);
    expect(pickCause([code])).toEqual(code);
    expect(pickCause([])).toBeNull();
  });

  test("among equals, the last one wins (closest to the failure)", () => {
    const first = { kind: "db" as const, code: "PGRST116", detail: "first", target: "orders" };
    const last = { kind: "db" as const, code: "23505", detail: "last", target: "orders" };
    expect(pickCause([first, last])).toEqual(last);
  });
});

describe("capturingFetch (Supabase clients)", () => {
  const pgError = { code: "22P02", message: 'invalid input syntax for type uuid: ""', details: null, hint: null };

  test("a PostgREST error is noted with its code, message and table — and returned untouched", async () => {
    const base = vi.fn(async () => Response.json(pgError, { status: 400 }));
    const f = capturingFetch(base as unknown as typeof fetch);
    await runWithCauses(async () => {
      const res = await f("https://x.supabase.co/rest/v1/cities?select=id&market_id=eq.");
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(pgError);
      expect(currentCauses()).toEqual([
        { kind: "db", code: "22P02", detail: 'invalid input syntax for type uuid: ""', target: "cities" },
      ]);
    });
  });

  test("an RPC error is named after the function", async () => {
    const base = vi.fn(async () =>
      Response.json({ code: "42883", message: "function public.x() does not exist" }, { status: 404 }),
    );
    const f = capturingFetch(base as unknown as typeof fetch);
    await runWithCauses(async () => {
      await f(new URL("https://x.supabase.co/rest/v1/rpc/get_team_day"), { method: "POST" });
      expect(currentCauses()[0]).toMatchObject({ kind: "db", code: "42883", target: "rpc:get_team_day" });
    });
  });

  test("a success notes nothing", async () => {
    const f = capturingFetch((async () => Response.json([])) as unknown as typeof fetch);
    await runWithCauses(async () => {
      await f("https://x.supabase.co/rest/v1/orders");
      expect(currentCauses()).toEqual([]);
    });
  });

  test("auth and storage errors are noted too, as db with the service name", async () => {
    const f = capturingFetch(
      (async () => Response.json({ error: "invalid_grant", error_description: "Invalid login" }, { status: 400 })) as unknown as typeof fetch,
    );
    await runWithCauses(async () => {
      await f("https://x.supabase.co/auth/v1/token?grant_type=password");
      expect(currentCauses()[0]).toMatchObject({ kind: "db", code: "invalid_grant", target: "auth" });
    });
  });

  test("a network failure is noted and re-thrown", async () => {
    const f = capturingFetch((async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch);
    await runWithCauses(async () => {
      await expect(f("https://x.supabase.co/rest/v1/orders")).rejects.toThrow("fetch failed");
      expect(currentCauses()[0]).toMatchObject({ kind: "db", code: "network", target: "orders" });
    });
  });
});

describe("console capture", () => {
  test("console.error inside a request is noted; outside, nothing changes", () => {
    const original = console.error;
    const sink = vi.fn();
    console.error = sink;
    try {
      installConsoleCapture();
      installConsoleCapture(); // idempotent
      runWithCauses(() => {
        console.error("[orders] update failed:", new Error("column orders.foo does not exist"));
        expect(currentCauses()[0]).toMatchObject({
          kind: "code",
          detail: "[orders] update failed: column orders.foo does not exist",
        });
      });
      console.error("outside");
      expect(sink).toHaveBeenCalledTimes(2);
    } finally {
      console.error = original;
    }
  });

  test("a logged Supabase error object keeps its code", () => {
    const original = console.error;
    console.error = vi.fn();
    try {
      installConsoleCapture();
      runWithCauses(() => {
        console.error("load failed", { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
        expect(currentCauses()[0]).toMatchObject({ kind: "code", code: "PGRST116" });
      });
    } finally {
      console.error = original;
    }
  });
});
