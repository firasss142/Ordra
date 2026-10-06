import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";

type Mod = typeof import("../ClientErrorReporter");
let ClientErrorReporter: Mod["ClientErrorReporter"];
let reportBrowserError: Mod["reportBrowserError"];

const fetchMock = vi.fn(async (..._a: unknown[]) => new Response(null, { status: 204 }));

beforeEach(async () => {
  // A fresh module per test: the per-page-load cap and dedupe start at zero.
  vi.resetModules();
  ({ ClientErrorReporter, reportBrowserError } = await import("../ClientErrorReporter"));
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function sentBodies() {
  return fetchMock.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)));
}

describe("reportBrowserError", () => {
  test("sends the crash with the page it happened on", () => {
    reportBrowserError({ kind: "boundary", name: "TypeError", message: "x is undefined", stack: "s" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/journal/browser-error",
      expect.objectContaining({ method: "POST", keepalive: true }),
    );
    expect(sentBodies()[0]).toMatchObject({ kind: "boundary", name: "TypeError", message: "x is undefined", page: "/" });
  });

  test("the same crash twice is sent once", () => {
    reportBrowserError({ name: "Error", message: "same" });
    reportBrowserError({ name: "Error", message: "same" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("at most 5 reports per page load, so a render loop cannot flood the journal", () => {
    for (let i = 0; i < 20; i++) reportBrowserError({ name: "Error", message: `m${i}` });
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  test("a failing send is swallowed", () => {
    fetchMock.mockImplementationOnce(() => {
      throw new Error("offline");
    });
    expect(() => reportBrowserError({ message: "boom" })).not.toThrow();
  });
});

describe("<ClientErrorReporter />", () => {
  test("reports uncaught errors from our own scripts", () => {
    render(<ClientErrorReporter />);
    window.dispatchEvent(
      new ErrorEvent("error", { message: "boom", filename: `${window.location.origin}/_next/static/chunks/app.js`, error: new Error("boom") }),
    );
    expect(sentBodies()[0]).toMatchObject({ kind: "error", message: "boom" });
  });

  test("ignores errors from other origins (extensions, ad scripts)", () => {
    render(<ClientErrorReporter />);
    window.dispatchEvent(new ErrorEvent("error", { message: "x", filename: "https://cdn.other.com/a.js" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("reports unhandled promise rejections", () => {
    render(<ClientErrorReporter />);
    const ev = new Event("unhandledrejection") as Event & { reason?: unknown };
    ev.reason = new Error("save failed");
    window.dispatchEvent(ev);
    expect(sentBodies()[0]).toMatchObject({ kind: "unhandledrejection", message: "save failed" });
  });

  test("stops listening when unmounted", () => {
    const { unmount } = render(<ClientErrorReporter />);
    unmount();
    window.dispatchEvent(new ErrorEvent("error", { message: "late", filename: `${window.location.origin}/a.js` }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
