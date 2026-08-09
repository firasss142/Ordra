import { describe, test, expect, vi, beforeEach } from "vitest";

const mockFrom = vi.fn();
const mockAdminFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
  }),
  createAdminClient: vi.fn().mockReturnValue({
    from: (...args: unknown[]) => mockAdminFrom(...args),
  }),
}));

vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});

vi.mock("@/lib/crypto", () => ({
  decrypt: (blob: string) => blob,
}));

import { GET } from "./route";
import { NextRequest } from "next/server";
import { setTestActor, resetTestActor } from "@/test/helpers/actorMock";

function req(url: string) {
  return new NextRequest(new URL(url, "http://localhost:3000"), { method: "GET" });
}

interface CarrierRow {
  id: string;
  delivery_fee: number;
  is_active: boolean;
}

/**
 * Mimics the real query chain. `rows` is what the (code, market_id) filter would
 * match — the point of these tests is that TWO rows must not blow up.
 */
function carriersChain(rows: CarrierRow[]) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.order = vi.fn().mockReturnValue(c);
  c.limit = vi.fn().mockResolvedValue({ data: rows, error: null });
  return c;
}

function credsChain(blob: string | null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.maybeSingle = vi.fn().mockResolvedValue({
    data: { api_credentials: blob },
    error: null,
  });
  return c;
}

const TRIPOLI = { id: "carrier-tripoli", delivery_fee: 10, is_active: true };
const BENGHAZI = { id: "carrier-benghazi", delivery_fee: 10, is_active: true };

beforeEach(() => {
  vi.clearAllMocks();
  resetTestActor();
  mockAdminFrom.mockReturnValue(credsChain(null));
});

describe("GET /api/carriers/active", () => {
  test("400 without code or market_id", async () => {
    const res = await GET(req("/api/carriers/active?code=dexpress"));
    expect(res.status).toBe(400);
  });

  test("403 when a manager asks about another market", async () => {
    setTestActor({ role: "market_manager", market_id: "m-1" });
    const res = await GET(req("/api/carriers/active?code=dexpress&market_id=m-2"));
    expect(res.status).toBe(403);
  });

  test("returns the carrier with cost_type defaulted to 1", async () => {
    mockFrom.mockReturnValue(carriersChain([{ ...TRIPOLI, id: "c-dex" }]));
    const res = await GET(req("/api/carriers/active?code=dexpress&market_id=m-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.carrier).toMatchObject({ id: "c-dex", cost_type: "1" });
  });

  test("reads cost_type out of the encrypted credentials blob", async () => {
    mockFrom.mockReturnValue(carriersChain([{ ...TRIPOLI, id: "c-dex" }]));
    mockAdminFrom.mockReturnValue(credsChain(JSON.stringify({ cost_type: "0" })));
    const res = await GET(req("/api/carriers/active?code=dexpress&market_id=m-1"));
    const body = await res.json();
    expect(body.carrier.cost_type).toBe("0");
  });

  test("returns a null carrier when nothing matches", async () => {
    mockFrom.mockReturnValue(carriersChain([]));
    const res = await GET(req("/api/carriers/active?code=dexpress&market_id=m-1"));
    expect(res.status).toBe(200);
    expect((await res.json()).carrier).toBeNull();
  });

  // Libya holds TWO darb_assabil rows (Tripoli + Benghazi) under one code —
  // UNIQUE(market_id, code) was relaxed to UNIQUE(market_id, code, name) in
  // 20260816000003. .maybeSingle() errors on multiple rows, so this used to 500.
  test("returns a single carrier when two rows share the code", async () => {
    mockFrom.mockReturnValue(carriersChain([TRIPOLI, BENGHAZI]));
    const res = await GET(req("/api/carriers/active?code=darb_assabil&market_id=m-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.carrier.id).toBe("carrier-tripoli");
  });

  test("prefers the carrier_id param when the code is ambiguous", async () => {
    const chain = carriersChain([BENGHAZI]);
    mockFrom.mockReturnValue(chain);
    const res = await GET(
      req(
        "/api/carriers/active?code=darb_assabil&market_id=m-1&carrier_id=carrier-benghazi",
      ),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).carrier.id).toBe("carrier-benghazi");
    // The id must reach the query, not just filter client-side.
    expect(chain.eq).toHaveBeenCalledWith("id", "carrier-benghazi");
  });

  test("500 when the carrier query fails", async () => {
    const c: Record<string, unknown> = {};
    c.select = vi.fn().mockReturnValue(c);
    c.eq = vi.fn().mockReturnValue(c);
    c.order = vi.fn().mockReturnValue(c);
    c.limit = vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } });
    mockFrom.mockReturnValue(c);
    const res = await GET(req("/api/carriers/active?code=dexpress&market_id=m-1"));
    expect(res.status).toBe(500);
  });
});
