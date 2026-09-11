import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { reassignOrders } from "../reassign-queue";

const fetchMock = vi.fn();

function res(status: number, body: unknown = {}) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("reassignOrders — locked orders", () => {
  it("counts a locked order separately from a genuine failure", async () => {
    fetchMock
      .mockImplementationOnce(() => res(200))
      .mockImplementationOnce(() =>
        res(409, { code: "locked", lock: { holder_name: "Salima" } }),
      )
      .mockImplementationOnce(() => res(500));

    const r = await reassignOrders(["o-1", "o-2", "o-3"], "agent-2");

    expect(r.ok).toBe(1);
    expect(r.locked).toBe(1);
    // A locked order is not a failure — it is a person mid-call, and lumping
    // the two together is what makes the toast unactionable.
    expect(r.failed).toBe(1);
  });

  it("names the agents still holding orders, without duplicates", async () => {
    fetchMock.mockImplementation(() =>
      res(409, { code: "locked", lock: { holder_name: "Salima" } }),
    );

    const r = await reassignOrders(["o-1", "o-2"], "agent-2");

    expect(r.lockedBy).toEqual(["Salima"]);
  });

  it("reports nothing locked when every call succeeds", async () => {
    fetchMock.mockImplementation(() => res(200));
    const r = await reassignOrders(["o-1", "o-2"], null);
    expect(r).toMatchObject({ ok: 2, failed: 0, locked: 0, lockedBy: [] });
  });
});
