import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockActor = vi.fn();
vi.mock("@/lib/auth/actor", () => ({ getActor: () => mockActor() }));
vi.mock("@/lib/journal/route-errors", () => ({
  withRouteErrors: (_r: string, _m: string, h: unknown) => h,
}));
vi.mock("@/lib/google-sheets/inspect-sheet", () => ({
  getServiceAccountEmail: () => "ordra@x.iam.gserviceaccount.com",
}));

import { GET } from "./route";

const req = () => new NextRequest(new URL("http://localhost/api/storefronts/sheets-service-account"));

beforeEach(() => vi.clearAllMocks());

describe("GET /api/storefronts/sheets-service-account", () => {
  test("gives a super admin the address to share a sheet with", async () => {
    mockActor.mockResolvedValue({ actor: { id: "u1", role: "super_admin", market_id: null } });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ email: "ordra@x.iam.gserviceaccount.com" });
  });

  test("is not for anyone who cannot connect a shop", async () => {
    mockActor.mockResolvedValue({ actor: { id: "u2", role: "market_manager", market_id: "m-ly" } });
    expect((await GET(req())).status).toBe(403);
  });
});
