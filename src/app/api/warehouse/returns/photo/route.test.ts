import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockUpload = vi.fn();
const mockCreateSignedUrl = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
  createAdminClient: vi.fn().mockReturnValue({
    storage: {
      from: () => ({
        upload: (...args: unknown[]) => mockUpload(...args),
        createSignedUrl: (...args: unknown[]) => mockCreateSignedUrl(...args),
      }),
    },
  }),
}));

import { POST } from "./route";
import { NextRequest } from "next/server";

function singleChain(data: unknown, error: unknown = null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data, error });
  return c;
}

function makeReq(body: unknown) {
  return new NextRequest(
    new URL("http://localhost/api/warehouse/returns/photo"),
    { method: "POST", body: JSON.stringify(body) },
  );
}

function authedWarehouse() {
  mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
  mockFrom.mockReturnValue(
    singleChain({ role: "warehouse_agent", market_id: "m-1" }),
  );
}

const TINY_JPEG =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAoHBwgHBgoICAg=";

beforeEach(() => vi.clearAllMocks());

describe("POST /api/warehouse/returns/photo — role guard", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(
      makeReq({ order_id: "o-1", data_url: TINY_JPEG }),
    );
    expect(res.status).toBe(401);
  });

  test("returns 403 for agent role", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-1" } } });
    mockFrom.mockReturnValue(singleChain({ role: "agent", market_id: "m-1" }));
    const res = await POST(
      makeReq({ order_id: "o-1", data_url: TINY_JPEG }),
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /api/warehouse/returns/photo — input validation", () => {
  test("400 on missing order_id", async () => {
    authedWarehouse();
    const res = await POST(makeReq({ data_url: TINY_JPEG }));
    expect(res.status).toBe(400);
  });

  test("400 on invalid data URL", async () => {
    authedWarehouse();
    const res = await POST(
      makeReq({ order_id: "o-1", data_url: "not-a-data-url" }),
    );
    expect(res.status).toBe(400);
  });

  test("400 on unsupported mime type", async () => {
    authedWarehouse();
    const res = await POST(
      makeReq({
        order_id: "o-1",
        data_url: "data:application/pdf;base64,JVBERi0xLjQK",
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /api/warehouse/returns/photo — upload", () => {
  test("uploads to market-scoped path and returns signed URL", async () => {
    authedWarehouse();
    mockUpload.mockResolvedValue({ data: { path: "ignored" }, error: null });
    mockCreateSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://signed.example/abc" },
      error: null,
    });
    const res = await POST(
      makeReq({ order_id: "order-xyz", data_url: TINY_JPEG }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.path).toMatch(/^m-1\/order-xyz\/[a-f0-9-]+\.jpeg$/);
    expect(json.signed_url).toBe("https://signed.example/abc");
    expect(mockUpload).toHaveBeenCalled();
    const [pathArg] = mockUpload.mock.calls[0];
    expect(pathArg).toMatch(/^m-1\/order-xyz\//);
  });

  test("returns 500 when upload fails", async () => {
    authedWarehouse();
    mockUpload.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await POST(
      makeReq({ order_id: "o-1", data_url: TINY_JPEG }),
    );
    expect(res.status).toBe(500);
  });
});
