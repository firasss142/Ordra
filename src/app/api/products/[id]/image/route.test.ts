import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockUpload = vi.fn();
const mockGetPublicUrl = vi.fn();
const mockAdminFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
  createAdminClient: vi.fn().mockReturnValue({
    from: (...args: unknown[]) => mockAdminFrom(...args),
    storage: {
      from: () => ({
        upload: (...args: unknown[]) => mockUpload(...args),
        getPublicUrl: (...args: unknown[]) => mockGetPublicUrl(...args),
      }),
    },
  }),
}));

import { PUT } from "./route";
import { NextRequest } from "next/server";

function singleChain(data: unknown, error: unknown = null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data, error });
  return c;
}

function updateChain(data: unknown, error: unknown = null) {
  const c: Record<string, unknown> = {};
  const updateSpy = vi.fn().mockReturnValue(c);
  c.update = updateSpy;
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data, error });
  return { chain: c, updateSpy };
}

function putReq(body: unknown) {
  return new NextRequest(new URL("http://localhost/api/products/p-1/image"), {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: "p-1" }) };

const TINY_JPEG =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAoHBwgHBgoICAg=";

const existingProduct = { id: "p-1", market_id: "m-tn", image_url: null };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PUT /api/products/[id]/image — role guard", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await PUT(putReq({ data_url: TINY_JPEG }), params);
    expect(res.status).toBe(401);
  });

  test("rejects market_manager with 403 even for their own market", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    mockFrom
      .mockReturnValueOnce(singleChain({ role: "market_manager", market_id: "m-tn" }))
      .mockReturnValueOnce(singleChain(existingProduct));
    const res = await PUT(putReq({ data_url: TINY_JPEG }), params);
    expect(res.status).toBe(403);
  });

  test("rejects warehouse_agent with 403", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    mockFrom
      .mockReturnValueOnce(singleChain({ role: "warehouse_agent", market_id: "m-tn" }))
      .mockReturnValueOnce(singleChain(existingProduct));
    const res = await PUT(putReq({ data_url: TINY_JPEG }), params);
    expect(res.status).toBe(403);
  });
});

describe("PUT /api/products/[id]/image — not found", () => {
  test("returns 404 when product does not exist", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    mockFrom
      .mockReturnValueOnce(singleChain({ role: "super_admin", market_id: null }))
      .mockReturnValueOnce(singleChain(null, { message: "not found" }));
    const res = await PUT(putReq({ data_url: TINY_JPEG }), params);
    expect(res.status).toBe(404);
  });
});

describe("PUT /api/products/[id]/image — input validation", () => {
  test("400 on invalid data URL", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    mockFrom
      .mockReturnValueOnce(singleChain({ role: "super_admin", market_id: null }))
      .mockReturnValueOnce(singleChain(existingProduct));
    const res = await PUT(putReq({ data_url: "not-a-data-url" }), params);
    expect(res.status).toBe(400);
  });

  test("400 on unsupported mime type", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    mockFrom
      .mockReturnValueOnce(singleChain({ role: "super_admin", market_id: null }))
      .mockReturnValueOnce(singleChain(existingProduct));
    const res = await PUT(
      putReq({ data_url: "data:application/pdf;base64,JVBERi0xLjQK" }),
      params,
    );
    expect(res.status).toBe(400);
  });
});

describe("PUT /api/products/[id]/image — upload", () => {
  test("uploads to market-scoped path and persists public URL", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    const products = updateChain({ ...existingProduct, image_url: "https://cdn/x.jpeg" });
    mockFrom
      .mockReturnValueOnce(singleChain({ role: "super_admin", market_id: null }))
      .mockReturnValueOnce(singleChain(existingProduct));
    mockAdminFrom.mockReturnValue(products.chain);
    mockUpload.mockResolvedValue({ data: { path: "ignored" }, error: null });
    mockGetPublicUrl.mockReturnValue({ data: { publicUrl: "https://cdn/x.jpeg" } });

    const res = await PUT(putReq({ data_url: TINY_JPEG }), params);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.image_url).toContain("https://cdn/x.jpeg");

    // Uploaded under the product's market-scoped path
    const [pathArg] = mockUpload.mock.calls[0];
    expect(pathArg).toMatch(/^m-tn\/p-1\/image\.jpeg$/);

    // image_url was written back to the row
    const updates = products.updateSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof updates.image_url).toBe("string");
    expect(updates.image_url as string).toContain("https://cdn/x.jpeg");
  });

  test("returns 500 when storage upload fails", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    mockFrom
      .mockReturnValueOnce(singleChain({ role: "super_admin", market_id: null }))
      .mockReturnValueOnce(singleChain(existingProduct));
    mockUpload.mockResolvedValue({ data: null, error: { message: "boom" } });

    const res = await PUT(putReq({ data_url: TINY_JPEG }), params);
    expect(res.status).toBe(500);
  });
});
