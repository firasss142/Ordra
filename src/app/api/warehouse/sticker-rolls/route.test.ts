import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

import { GET, POST, PATCH } from "./route";
import { NextRequest } from "next/server";

/**
 * Registering a roll is what arms the scan guard: with no open roll the bench
 * accepts any number, because refusing every scan on day one would be worse.
 * So this route is the on-switch, and it has to be hard to arm it wrongly.
 */

function post(body: unknown) {
  return new NextRequest(new URL("http://localhost/api/warehouse/sticker-rolls"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}
function patch(body: unknown) {
  return new NextRequest(new URL("http://localhost/api/warehouse/sticker-rolls"), {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

function wire({
  actor = { role: "warehouse_agent", market_id: "m-1" } as Record<string, unknown> | null,
  insertError = null as { message: string } | null,
  carriers = [] as Array<Record<string, unknown>>,
} = {}) {
  const insert = vi.fn().mockResolvedValue({ error: insertError });
  const updateEq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ eq: updateEq });

  mockFrom.mockImplementation((table: string) => {
    const c: Record<string, unknown> = {};
    c.select = vi.fn().mockReturnValue(c);
    c.eq = vi.fn().mockReturnValue(c);
    c.order = vi.fn().mockResolvedValue({ data: carriers, error: null });
    c.single = vi.fn().mockResolvedValue({ data: actor, error: null });
    c.maybeSingle = vi.fn().mockResolvedValue({ data: actor, error: null });
    if (table === "sticker_rolls") {
      c.insert = insert;
      c.update = update;
    }
    return c;
  });
  return { insert, update, updateEq };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
  mockRpc.mockResolvedValue({ data: [], error: null });
});

describe("GET /api/warehouse/sticker-rolls", () => {
  test("returns the rolls with their derived consumption", async () => {
    wire();
    mockRpc.mockResolvedValue({
      data: [{ id: "r1", colour_fr: "Vert", capacity: 100, consumed: 42, remaining: 58, next_number: 889230 }],
      error: null,
    });
    const res = await GET(new NextRequest(new URL("http://localhost/api/warehouse/sticker-rolls")));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.rolls[0].remaining).toBe(58);
    expect(mockRpc).toHaveBeenCalledWith("get_sticker_rolls", expect.anything());
  });

  test("403 for an agent who cannot scan", async () => {
    wire({ actor: { role: "agent", market_id: "m-1" } });
    const res = await GET(new NextRequest(new URL("http://localhost/api/warehouse/sticker-rolls")));
    expect(res.status).toBe(403);
  });

  test("also returns the accounts a roll can be opened against", async () => {
    // The registration form needs them, and asking a second endpoint for a
    // two-row list would be a round trip for nothing.
    wire({
      carriers: [
        { id: "c-tripoli", name: "Darb Assabil - Tripoli" },
        { id: "c-benghazi", name: "Darb Assabil — Benghazi" },
      ],
    });
    const res = await GET(new NextRequest(new URL("http://localhost/api/warehouse/sticker-rolls")));
    const json = await res.json();
    expect(json.accounts).toEqual([
      { id: "c-tripoli", name: "Darb Assabil - Tripoli" },
      { id: "c-benghazi", name: "Darb Assabil — Benghazi" },
    ]);
  });

  test("offers no account when no carrier supplies its own stickers", async () => {
    // Tunisia prints its own labels, so there is no roll to register there.
    wire({ carriers: [] });
    const res = await GET(new NextRequest(new URL("http://localhost/api/warehouse/sticker-rolls")));
    expect((await res.json()).accounts).toEqual([]);
  });
});

describe("POST /api/warehouse/sticker-rolls", () => {
  const valid = {
    carrier_id: "11111111-1111-1111-1111-111111111111",
    color_hex: "#339307",
    range_start: 889188,
    range_end: 889287,
    label: "Rouleau vert #3",
  };

  test("opens a roll", async () => {
    const { insert } = wire();
    const res = await POST(post(valid));
    expect(res.status).toBe(201);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        carrier_id: valid.carrier_id,
        color_hex: "#339307",
        range_start: 889188,
        range_end: 889287,
        opened_by: "wh-1",
      }),
    );
  });

  test("lowercases the colour so it matches the zone key", async () => {
    const { insert } = wire();
    await POST(post({ ...valid, color_hex: "#339307".toUpperCase() }));
    expect((insert.mock.calls[0][0] as { color_hex: string }).color_hex).toBe("#339307");
  });

  test.each([
    [{ color_hex: "#123456" }, /couleur/i],
    [{ range_start: 0 }, /numéro/i],
    [{ range_end: 889100 }, /ordre|supérieur/i],
    // Both numbers well-formed, but a 100k-wide "roll" is not a roll.
    [{ range_start: 100000, range_end: 200000 }, /trop/i],
    [{ carrier_id: "" }, /transporteur/i],
  ])("refuses %o", async (patchBody, matcher) => {
    wire();
    const res = await POST(post({ ...valid, ...patchBody }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(matcher);
  });

  test("turns the overlap constraint into a message about the other roll", async () => {
    wire({
      insertError: {
        message: 'conflicting key value violates exclusion constraint "sticker_rolls_no_overlap"',
      },
    });
    const res = await POST(post(valid));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/chevauche/i);
  });

  test("names an RLS refusal instead of leaking db_error", async () => {
    // A roll for another market's carrier. Only a real submission surfaced
    // this — the mock never meets row-level security.
    wire({
      insertError: {
        message: 'new row violates row-level security policy for table "sticker_rolls"',
      },
    });
    const res = await POST(post(valid));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/ne pouvez pas enregistrer/i);
  });

  test("403 for an agent who cannot scan", async () => {
    wire({ actor: { role: "agent", market_id: "m-1" } });
    expect((await POST(post(valid))).status).toBe(403);
  });
});

describe("PATCH /api/warehouse/sticker-rolls", () => {
  test("closes a roll as exhausted and stamps the time", async () => {
    const { update, updateEq } = wire();
    const res = await PATCH(patch({ id: "roll-1", status: "exhausted" }));
    expect(res.status).toBe(200);
    const written = update.mock.calls[0][0] as { status: string; closed_at: string };
    expect(written.status).toBe("exhausted");
    expect(written.closed_at).toBeTruthy();
    expect(updateEq).toHaveBeenCalledWith("id", "roll-1");
  });

  test("reopening a roll clears the closing stamp", async () => {
    const { update } = wire();
    await PATCH(patch({ id: "roll-1", status: "open" }));
    expect((update.mock.calls[0][0] as { closed_at: null }).closed_at).toBeNull();
  });

  test("refuses a status the schema does not allow", async () => {
    wire();
    const res = await PATCH(patch({ id: "roll-1", status: "burned" }));
    expect(res.status).toBe(400);
  });

  test("requires an id", async () => {
    wire();
    expect((await PATCH(patch({ status: "void" }))).status).toBe(400);
  });
});
