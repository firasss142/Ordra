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

import { PATCH, DELETE } from "./route";
import { getActor } from "@/lib/auth/actor";
import { NextRequest } from "next/server";

const TN = "00000000-0000-0000-0000-000000000001";
const LY = "00000000-0000-0000-0000-000000000002";

function req(method: "PATCH" | "DELETE", body?: unknown) {
  const init: { method: string; body?: string } = { method };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new NextRequest(
    new URL("/api/settings/statuses/s1", "http://localhost:3000"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    init as any
  );
}

const params = { params: Promise.resolve({ id: "s1" }) };

function statusRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "s1",
    market_id: TN,
    scope: "prospect",
    key: "attempt_1",
    label_fr: "Tentative 1",
    label_ar: "محاولة 1",
    color: "#8B5CF6",
    sort_order: 3,
    is_initial: false,
    is_terminal: false,
    allowed_transitions: [],
    ...overrides,
  };
}

function fetchChain(row: unknown) {
  const c: Record<string, ReturnType<typeof vi.fn>> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data: row, error: null });
  return c;
}

function updateChain(row: unknown, error: unknown = null) {
  const c: Record<string, ReturnType<typeof vi.fn>> = {};
  c.update = vi.fn().mockReturnValue(c);
  c.delete = vi.fn().mockReturnValue(c);
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data: row, error });
  c.limit = vi.fn().mockReturnValue(c);
  return c;
}

function countChain(count: number) {
  const c: Record<string, ReturnType<typeof vi.fn>> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.limit = vi.fn().mockResolvedValue({ data: [], count, error: null });
  return c;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PATCH /api/settings/statuses/[id]", () => {
  test("404 when status not found", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "mgr", role: "market_manager", market_id: TN },
    });
    mockFrom.mockReturnValue(fetchChain(null));

    const res = await PATCH(req("PATCH", { label_fr: "X" }), params);
    expect(res.status).toBe(404);
  });

  test("403 when manager targets other market's status", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "mgr", role: "market_manager", market_id: TN },
    });
    mockFrom.mockReturnValue(fetchChain(statusRow({ market_id: LY })));

    const res = await PATCH(req("PATCH", { label_fr: "X" }), params);
    expect(res.status).toBe(403);
  });

  test("400 when body is empty", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "mgr", role: "market_manager", market_id: TN },
    });
    mockFrom.mockReturnValue(fetchChain(statusRow()));

    const res = await PATCH(req("PATCH", {}), params);
    expect(res.status).toBe(400);
  });

  test("400 when attempting to change key", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "mgr", role: "market_manager", market_id: TN },
    });
    mockFrom.mockReturnValue(fetchChain(statusRow()));

    const res = await PATCH(req("PATCH", { key: "renamed" }), params);
    expect(res.status).toBe(400);
  });

  test("200 on successful label update", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "mgr", role: "market_manager", market_id: TN },
    });
    const fetchC = fetchChain(statusRow());
    const updateC = updateChain(statusRow({ label_fr: "Renamed" }));
    mockFrom
      .mockReturnValueOnce(fetchC)
      .mockReturnValueOnce(updateC);

    const res = await PATCH(req("PATCH", { label_fr: "Renamed" }), params);
    expect(res.status).toBe(200);
    expect(updateC.update).toHaveBeenCalledWith(
      expect.objectContaining({ label_fr: "Renamed" })
    );
  });

  test("agent is rejected", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "a", role: "agent", market_id: TN },
    });

    const res = await PATCH(req("PATCH", { label_fr: "X" }), params);
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/settings/statuses/[id]", () => {
  test("404 when status not found", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "mgr", role: "market_manager", market_id: TN },
    });
    mockFrom.mockReturnValue(fetchChain(null));

    const res = await DELETE(req("DELETE"), params);
    expect(res.status).toBe(404);
  });

  test("403 when manager targets other market", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "mgr", role: "market_manager", market_id: TN },
    });
    mockFrom.mockReturnValue(fetchChain(statusRow({ market_id: LY })));

    const res = await DELETE(req("DELETE"), params);
    expect(res.status).toBe(403);
  });

  test("409 when status is initial (cannot delete)", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "mgr", role: "market_manager", market_id: TN },
    });
    mockFrom.mockReturnValue(fetchChain(statusRow({ is_initial: true })));

    const res = await DELETE(req("DELETE"), params);
    expect(res.status).toBe(409);
  });

  test("409 when prospect status is in use by leads", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "mgr", role: "market_manager", market_id: TN },
    });
    const fetchC = fetchChain(statusRow());
    const usageC = countChain(5);
    mockFrom
      .mockReturnValueOnce(fetchC)
      .mockReturnValueOnce(usageC);

    const res = await DELETE(req("DELETE"), params);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/in use/i);
  });

  test("200 when status has no live rows", async () => {
    vi.mocked(getActor).mockResolvedValue({
      actor: { id: "mgr", role: "market_manager", market_id: TN },
    });
    const fetchC = fetchChain(statusRow({ key: "unused_status" }));
    const usageC = countChain(0);
    const deleteC = updateChain({ id: "s1" });
    mockFrom
      .mockReturnValueOnce(fetchC)
      .mockReturnValueOnce(usageC)
      .mockReturnValueOnce(deleteC);

    const res = await DELETE(req("DELETE"), params);
    expect(res.status).toBe(200);
    expect(deleteC.delete).toHaveBeenCalled();
  });
});
