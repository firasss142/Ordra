import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, renderHook, act } from "@testing-library/react";
import { useOrderPresence } from "../useOrderPresence";

const fetchMock = vi.fn();
const beaconMock = vi.fn(() => true);

function jsonOk(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

function bodyOf(call: unknown[]) {
  return JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>;
}

let visibility = "visible";

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset().mockImplementation(() =>
    jsonOk({ data: { tracked: true, expires_at: "z", server_now: "z", blocking_agent: null } }),
  );
  beaconMock.mockClear();
  visibility = "visible";
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("navigator", { sendBeacon: beaconMock });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
});

afterEach(() => {
  // Unmount BEFORE the fetch stub is torn down. React runs the hook's cleanup
  // (which posts a release) during unmount, and letting that hit the real
  // fetch produces "Invalid URL" noise that would hide a genuine failure.
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const render = (orderId: string | null, role = "agent") =>
  renderHook(({ id }) => useOrderPresence({ orderId: id, role }), {
    initialProps: { id: orderId },
  });

describe("useOrderPresence", () => {
  test("acquires once on open, with a stable per-tab session id", async () => {
    render("o-1");
    await act(async () => { await Promise.resolve(); });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = bodyOf(fetchMock.mock.calls[0]);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/orders/o-1/presence");
    expect(body.action).toBe("acquire");
    expect(typeof body.session_id).toBe("string");
    expect((body.session_id as string).length).toBeGreaterThan(10);
  });

  test("beats every 25s and reuses the same session id", async () => {
    render("o-1");
    await act(async () => { await Promise.resolve(); });
    const session = bodyOf(fetchMock.mock.calls[0]).session_id;

    await act(async () => { await vi.advanceTimersByTimeAsync(25_000); });

    const beat = bodyOf(fetchMock.mock.calls[1]);
    expect(beat.action).toBe("heartbeat");
    expect(beat.session_id).toBe(session);
  });

  // A tab left open overnight must not hold a lock a market_manager cannot break.
  test("stops beating while the tab is hidden", async () => {
    render("o-1");
    await act(async () => { await Promise.resolve(); });
    const before = fetchMock.mock.calls.length;

    visibility = "hidden";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(fetchMock.mock.calls.length).toBe(before);
  });

  test("re-acquires (not heartbeats) when the tab becomes visible again", async () => {
    render("o-1");
    await act(async () => { await Promise.resolve(); });

    visibility = "hidden";
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    visibility = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    const last = bodyOf(fetchMock.mock.calls[fetchMock.mock.calls.length - 1]);
    expect(last.action).toBe("acquire");
  });

  // sendBeacon is POST-only and sends text/plain unless handed a typed Blob.
  test("releases through sendBeacon on pagehide, as a typed JSON Blob", async () => {
    render("o-1");
    await act(async () => { await Promise.resolve(); });

    await act(async () => { window.dispatchEvent(new Event("pagehide")); });

    expect(beaconMock).toHaveBeenCalledTimes(1);
    const [url, blob] = beaconMock.mock.calls[0] as unknown as [string, Blob];
    expect(url).toBe("/api/orders/o-1/presence");
    expect(blob.type).toBe("application/json");
  });

  test("releases on unmount", async () => {
    const { unmount } = render("o-1");
    await act(async () => { await Promise.resolve(); });
    fetchMock.mockClear();

    unmount();

    expect(bodyOf(fetchMock.mock.calls[0]).action).toBe("release");
  });

  test("reports the blocking agent so a manager can be told who holds it", async () => {
    fetchMock.mockImplementation(() =>
      jsonOk({
        data: {
          tracked: true,
          blocking_agent: { user_id: "a-9", full_name: "Salima", opened_at: "t", expires_at: "t2" },
        },
      }),
    );
    const { result } = render("o-1", "market_manager");
    await act(async () => { await Promise.resolve(); });

    expect(result.current.blockingAgent?.full_name).toBe("Salima");
  });

  // Belt to the broadcast's braces: if the socket is down, the next beat is
  // what tells the agent a super_admin took the order.
  test("surfaces lock loss when a heartbeat answers 409 lock_lost", async () => {
    const onLockLost = vi.fn();
    renderHook(() => useOrderPresence({ orderId: "o-1", role: "agent", onLockLost }));
    await act(async () => { await Promise.resolve(); });

    fetchMock.mockImplementation(() => jsonOk({ code: "lock_lost" }, 409));
    await act(async () => { await vi.advanceTimersByTimeAsync(25_000); });

    expect(onLockLost).toHaveBeenCalled();
  });

  test("does nothing at all when no order is open", async () => {
    render(null);
    await act(async () => { await Promise.resolve(); });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/**
 * The "sometimes the typing bubble never appears" bug.
 *
 * `mode` used to ride the 25s heartbeat while a typing burst only lasts
 * TYPING_IDLE_MS (4s), so the bubble had roughly a 4-in-25 chance of being
 * sampled at all, and up to 25s of lag when it was.
 */
describe("useOrderPresence — mode is pushed, not sampled", () => {
  const renderWithMode = (mode: "viewing" | "editing") =>
    renderHook(({ m }) => useOrderPresence({ orderId: "o-1", role: "agent", mode: m }), {
      initialProps: { m: mode },
    });

  test("publishes a mode change immediately, not on the next 25s beat", async () => {
    const { rerender } = renderWithMode("viewing");
    await act(async () => { await Promise.resolve(); });
    fetchMock.mockClear();

    rerender({ m: "editing" });
    await act(async () => { await Promise.resolve(); });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = bodyOf(fetchMock.mock.calls[0]);
    expect(body.action).toBe("heartbeat");
    expect(body.mode).toBe("editing");
  });

  test("falling back to viewing is pushed too, so the bubble clears on time", async () => {
    const { rerender } = renderWithMode("editing");
    await act(async () => { await Promise.resolve(); });
    fetchMock.mockClear();

    rerender({ m: "viewing" });
    await act(async () => { await Promise.resolve(); });

    expect(bodyOf(fetchMock.mock.calls[0]).mode).toBe("viewing");
  });

  // Every keystroke re-renders the panel; only a transition may cost a request.
  test("does not post when a re-render leaves the mode unchanged", async () => {
    const { rerender } = renderWithMode("editing");
    await act(async () => { await Promise.resolve(); });
    fetchMock.mockClear();

    rerender({ m: "editing" });
    await act(async () => { await Promise.resolve(); });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  // Heartbeating a row that does not exist yet answers 409 lock_lost, which
  // would throw the agent onto the takeover screen for typing too fast.
  test("holds a mode change until the acquire has landed, then flushes it", async () => {
    let landAcquire = () => {};
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          landAcquire = () =>
            resolve({
              ok: true,
              status: 200,
              json: () => Promise.resolve({ data: { tracked: true, blocking_agent: null } }),
            } as Response);
        }),
    );

    const { rerender } = renderWithMode("viewing");
    rerender({ m: "editing" });
    await act(async () => { await Promise.resolve(); });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(bodyOf(fetchMock.mock.calls[0]).action).toBe("acquire");

    await act(async () => { landAcquire(); await Promise.resolve(); await Promise.resolve(); });

    const last = bodyOf(fetchMock.mock.calls[fetchMock.mock.calls.length - 1]);
    expect(last.action).toBe("heartbeat");
    expect(last.mode).toBe("editing");
  });
});
