import { describe, test, expect, vi, beforeEach } from "vitest";

const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

vi.mock("@/lib/auth/actor", () => ({
  getActor: vi.fn(),
}));

import { GET, POST } from "./route";
import { getActor } from "@/lib/auth/actor";
import { NextRequest } from "next/server";

const TN = "00000000-0000-0000-0000-000000000001";
const LY = "00000000-0000-0000-0000-000000000002";

function req(method: "GET" | "POST", url: string, body?: unknown) {
  const init: { method: string; body?: string } = { method };
  if (body !== undefined) init.body = JSON.stringify(body);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextRequest(new URL(url, "http://localhost:3000"), init as any);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asActor = (a: unknown) => ({ actor: a }) as any;

const superAdmin = asActor({ id: "u1", role: "super_admin", market_id: null });
const tnManager = asActor({ id: "u2", role: "market_manager", market_id: TN });
const tnAgent = asActor({ id: "u3", role: "agent", market_id: TN });

interface Chain {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
}

function chain(over: Partial<Record<keyof Chain, unknown>> = {}): Chain {
  const c: Partial<Chain> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.is = vi.fn().mockReturnValue(c);
  c.order = vi.fn().mockResolvedValue({ data: [], error: null });
  c.insert = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data: null, error: null });
  Object.assign(c, over);
  return c as Chain;
}

const validBody = {
  market_id: TN,
  parent_key: "refus_client",
  key: "trop_cher_apres_promo",
  label_fr: "Trop cher après la fin de la promo",
  label_ar: "غالي بعد انتهاء العرض",
  short_fr: "Promo finie",
  short_ar: "انتهى العرض",
};

beforeEach(() => vi.clearAllMocks());

describe("GET /api/settings/rejection-reasons", () => {
  test("401 when unauthenticated", async () => {
    vi.mocked(getActor).mockResolvedValue({
      response: new Response("{}", { status: 401 }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const res = await GET(req("GET", "/api/settings/rejection-reasons"));
    expect(res.status).toBe(401);
  });

  // The agent's picker reads the same list the manager edits.
  test("an agent may read their own market's taxonomy", async () => {
    vi.mocked(getActor).mockResolvedValue(tnAgent);
    const c = chain({
      order: vi.fn().mockResolvedValue({ data: [{ key: "refus_client" }], error: null }),
    });
    mockFrom.mockReturnValue(c);

    const res = await GET(req("GET", "/api/settings/rejection-reasons"));
    expect(res.status).toBe(200);
    expect(c.eq).toHaveBeenCalledWith("market_id", TN);
  });

  test("400 when a super_admin names no market", async () => {
    vi.mocked(getActor).mockResolvedValue(superAdmin);
    const res = await GET(req("GET", "/api/settings/rejection-reasons"));
    expect(res.status).toBe(400);
  });

  test("403 when a manager asks for another market", async () => {
    vi.mocked(getActor).mockResolvedValue(tnManager);
    const res = await GET(
      req("GET", `/api/settings/rejection-reasons?market_id=${LY}`),
    );
    expect(res.status).toBe(403);
  });

  test("a manager's own market_id is used even when the query omits it", async () => {
    vi.mocked(getActor).mockResolvedValue(tnManager);
    const c = chain();
    mockFrom.mockReturnValue(c);

    await GET(req("GET", "/api/settings/rejection-reasons"));
    expect(c.eq).toHaveBeenCalledWith("market_id", TN);
  });
});

describe("POST /api/settings/rejection-reasons", () => {
  test("403 for an agent", async () => {
    vi.mocked(getActor).mockResolvedValue(tnAgent);
    const res = await POST(
      req("POST", "/api/settings/rejection-reasons", validBody),
    );
    expect(res.status).toBe(403);
  });

  test("403 when a manager writes into another market", async () => {
    vi.mocked(getActor).mockResolvedValue(tnManager);
    const res = await POST(
      req("POST", "/api/settings/rejection-reasons", {
        ...validBody,
        market_id: LY,
      }),
    );
    expect(res.status).toBe(403);
  });

  // The whole point of the decision: groups mirror a Postgres enum, which
  // cannot grow from a form.
  test("409 when creating a top-level group", async () => {
    vi.mocked(getActor).mockResolvedValue(superAdmin);
    const res = await POST(
      req("POST", "/api/settings/rejection-reasons", {
        ...validBody,
        parent_key: null,
      }),
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/group/i);
  });

  test("400 on a malformed key", async () => {
    vi.mocked(getActor).mockResolvedValue(superAdmin);
    for (const key of ["Trop Cher", "2_chers", "trop-cher", ""]) {
      const res = await POST(
        req("POST", "/api/settings/rejection-reasons", { ...validBody, key }),
      );
      expect(res.status).toBe(400);
    }
  });

  test("400 when a label is missing", async () => {
    vi.mocked(getActor).mockResolvedValue(superAdmin);
    const res = await POST(
      req("POST", "/api/settings/rejection-reasons", {
        ...validBody,
        short_ar: undefined,
      }),
    );
    expect(res.status).toBe(400);
  });

  test("404 when the parent group does not exist in that market", async () => {
    vi.mocked(getActor).mockResolvedValue(superAdmin);
    mockFrom.mockReturnValue(
      chain({ single: vi.fn().mockResolvedValue({ data: null, error: null }) }),
    );

    const res = await POST(
      req("POST", "/api/settings/rejection-reasons", {
        ...validBody,
        parent_key: "groupe_invente",
      }),
    );
    expect(res.status).toBe(404);
  });

  test("creates a sub-reason under an existing group", async () => {
    vi.mocked(getActor).mockResolvedValue(superAdmin);
    const created = { id: "new-1", ...validBody };
    const c = chain({
      single: vi
        .fn()
        // the parent lookup, then the insert
        .mockResolvedValueOnce({ data: { key: "refus_client" }, error: null })
        .mockResolvedValueOnce({ data: created, error: null }),
    });
    mockFrom.mockReturnValue(c);

    const res = await POST(
      req("POST", "/api/settings/rejection-reasons", validBody),
    );

    expect(res.status).toBe(201);
    expect(c.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        market_id: TN,
        parent_key: "refus_client",
        key: "trop_cher_apres_promo",
        is_active: true,
      }),
    );
  });

  test("409 on a key already used in that market", async () => {
    vi.mocked(getActor).mockResolvedValue(superAdmin);
    mockFrom.mockReturnValue(
      chain({
        single: vi
          .fn()
          .mockResolvedValueOnce({ data: { key: "refus_client" }, error: null })
          .mockResolvedValueOnce({
            data: null,
            error: { message: 'duplicate key value violates unique constraint' },
          }),
      }),
    );

    const res = await POST(
      req("POST", "/api/settings/rejection-reasons", validBody),
    );
    expect(res.status).toBe(409);
  });

  // A sub-reason never carries its own colour — it inherits the group's, so the
  // five kinds of failure stay separable down a column.
  test("ignores a hue sent on a sub-reason", async () => {
    vi.mocked(getActor).mockResolvedValue(superAdmin);
    const c = chain({
      single: vi
        .fn()
        .mockResolvedValueOnce({ data: { key: "refus_client" }, error: null })
        .mockResolvedValueOnce({ data: { id: "x" }, error: null }),
    });
    mockFrom.mockReturnValue(c);

    await POST(
      req("POST", "/api/settings/rejection-reasons", {
        ...validBody,
        hue: "green",
      }),
    );

    expect(c.insert).toHaveBeenCalledWith(
      expect.not.objectContaining({ hue: "green" }),
    );
  });
});
