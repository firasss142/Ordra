import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});

const mockFrom = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({ from: (...a: unknown[]) => mockFrom(...a) }),
}));

import { GET } from "./route";
import { NextRequest } from "next/server";
import { setTestActor, resetTestActor } from "@/test/helpers/actorMock";

function chain(data: unknown, spy?: Record<string, ReturnType<typeof vi.fn>>) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "limit"]) {
    c[m] = vi.fn().mockImplementation((...args: unknown[]) => {
      spy?.[m]?.(...args);
      return c;
    });
  }
  c.then = (res: (v: unknown) => unknown) => res({ data, error: null });
  return c;
}

const ROW = {
  id: "w-1",
  investor_id: "inv-1",
  market_id: "m-tn",
  amount: 300,
  status: "requested",
  requested_at: "2026-08-02T10:00:00.000Z",
  decided_at: null,
  paid_at: null,
  payout_reference: null,
  note: null,
  investors: { legal_name: "Ilyes Capital SARL" },
};

const req = (qs = "") =>
  new NextRequest(new URL(`http://localhost/api/admin/investments/withdrawals${qs}`));

beforeEach(() => {
  resetTestActor();
  mockFrom.mockReset();
});

describe("GET withdrawal queue", () => {
  test("returns requests with the investor's name attached", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    mockFrom.mockImplementation(() => chain([ROW]));

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data[0].investors.legal_name).toBe("Ilyes Capital SARL");
  });

  test("filters by status when asked", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    const inSpy = vi.fn();
    mockFrom.mockImplementation(() => chain([ROW], { in: inSpy }));

    await GET(req("?status=requested"));

    expect(inSpy).toHaveBeenCalledWith("status", ["requested"]);
  });

  test("accepts several statuses", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    const inSpy = vi.fn();
    mockFrom.mockImplementation(() => chain([ROW], { in: inSpy }));

    await GET(req("?status=requested,approved"));

    expect(inSpy).toHaveBeenCalledWith("status", ["requested", "approved"]);
  });

  test("ignores an unknown status rather than returning nothing", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    const inSpy = vi.fn();
    mockFrom.mockImplementation(() => chain([ROW], { in: inSpy }));

    await GET(req("?status=bogus"));

    expect(inSpy).not.toHaveBeenCalled();
  });

  test("scopes a market_manager to their own market", async () => {
    setTestActor({ role: "market_manager", market_id: "m-tn" });
    const eqSpy = vi.fn();
    mockFrom.mockImplementation(() => chain([ROW], { eq: eqSpy }));

    await GET(req());

    expect(eqSpy).toHaveBeenCalledWith("market_id", "m-tn");
  });

  test("does not scope a super_admin", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    const eqSpy = vi.fn();
    mockFrom.mockImplementation(() => chain([ROW], { eq: eqSpy }));

    await GET(req());

    expect(eqSpy).not.toHaveBeenCalledWith("market_id", expect.anything());
  });

  test("an agent may not read the queue", async () => {
    setTestActor({ role: "agent", market_id: "m-tn" });
    expect((await GET(req())).status).toBe(403);
  });

  test("an investor may not read the queue", async () => {
    setTestActor({ role: "investor", market_id: "m-tn" });
    expect((await GET(req())).status).toBe(403);
  });
});
