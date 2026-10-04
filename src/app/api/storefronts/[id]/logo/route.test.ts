import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockExisting = vi.fn();
const mockUpdate = vi.fn();
const mockUpload = vi.fn();
const updates: Record<string, unknown>[] = [];

vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});

vi.mock("@/lib/logos", () => ({
  uploadLogoDataUrl: (...args: unknown[]) => mockUpload(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: vi.fn().mockReturnValue({
    from: (table: string) => {
      if (table !== "storefronts") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({ eq: () => ({ single: () => mockExisting() }) }),
        update: (patch: Record<string, unknown>) => {
          updates.push(patch);
          return { eq: () => ({ select: () => ({ single: () => mockUpdate() }) }) };
        },
      };
    },
  }),
}));

import { setTestActor, resetTestActor } from "@/test/helpers/actorMock";
import { PUT } from "./route";

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const ctx = { params: Promise.resolve({ id: "sf-1" }) };
const put = (body: unknown) =>
  PUT(new NextRequest("http://x/api/storefronts/sf-1/logo", { method: "PUT", body: JSON.stringify(body) }), ctx);

describe("PUT /api/storefronts/[id]/logo", () => {
  beforeEach(() => {
    resetTestActor();
    setTestActor({ role: "super_admin", market_id: null, id: "sa-1" });
    updates.length = 0;
    mockExisting.mockReset().mockResolvedValue({ data: { id: "sf-1", market_id: "m-1" } });
    mockUpdate.mockReset().mockResolvedValue({ data: { id: "sf-1", logo_url: "https://cdn/l.png?v=1" }, error: null });
    mockUpload.mockReset().mockResolvedValue({ ok: true, url: "https://cdn/l.png?v=1" });
  });

  test("uploads the image and stores its URL on the shop", async () => {
    const res = await put({ logo: PNG });
    expect(res.status).toBe(200);
    expect(mockUpload).toHaveBeenCalledWith("storefront", "sf-1", PNG);
    expect(updates).toEqual([{ logo_url: "https://cdn/l.png?v=1" }]);
    expect(await res.json()).toEqual({ logo_url: "https://cdn/l.png?v=1" });
  });

  test("null removes the logo — back to the platform mark", async () => {
    const res = await put({ logo: null });
    expect(res.status).toBe(200);
    expect(mockUpload).not.toHaveBeenCalled();
    expect(updates).toEqual([{ logo_url: null }]);
  });

  test("a market manager cannot change a shop's logo", async () => {
    setTestActor({ role: "market_manager", market_id: "m-1" });
    expect((await put({ logo: PNG })).status).toBe(403);
    expect(updates).toEqual([]);
  });

  test("an unknown shop is a 404", async () => {
    mockExisting.mockResolvedValue({ data: null });
    expect((await put({ logo: PNG })).status).toBe(404);
  });

  test("a body without a logo key is a 400, not a silent removal", async () => {
    expect((await put({})).status).toBe(400);
    expect(updates).toEqual([]);
  });

  test("an upload failure is passed through and nothing is written", async () => {
    mockUpload.mockResolvedValue({ ok: false, error: "Image too large", status: 413 });
    expect((await put({ logo: PNG })).status).toBe(413);
    expect(updates).toEqual([]);
  });

  test("no session is a 401", async () => {
    setTestActor(null);
    expect((await put({ logo: PNG })).status).toBe(401);
  });
});
