import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetActor = vi.fn();
const mockVerifyAndDelete = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({}),
  createAdminClient: vi.fn().mockReturnValue({}),
}));

vi.mock("@/lib/auth/actor", () => ({
  getActor: (...args: unknown[]) => mockGetActor(...args),
}));

vi.mock("@/lib/orders/duplicate-delete", async () => {
  const actual = await vi.importActual<typeof import("@/lib/orders/duplicate-delete")>(
    "@/lib/orders/duplicate-delete",
  );
  return {
    ...actual,
    verifyAndDeleteDuplicateSibling: (...args: unknown[]) => mockVerifyAndDelete(...args),
  };
});

import { POST } from "./route";
import { DuplicateSiblingError } from "@/lib/orders/duplicate-delete";
import { NextRequest } from "next/server";

const AGENT = { id: "agent-1", role: "agent", market_id: "m-1" };

function createRequest(body?: unknown) {
  return new NextRequest(
    new URL("http://localhost:3000/api/orders/anchor-1/delete-duplicate"),
    {
      method: "POST",
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
  );
}

const params = { params: Promise.resolve({ id: "anchor-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActor.mockResolvedValue({ actor: AGENT });
});

describe("POST /api/orders/[id]/delete-duplicate", () => {
  test("returns 401 when unauthenticated", async () => {
    mockGetActor.mockResolvedValue({
      response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    });
    const res = await POST(createRequest({ sibling_id: "sib-1" }), params);
    expect(res.status).toBe(401);
    expect(mockVerifyAndDelete).not.toHaveBeenCalled();
  });

  test("returns 400 when sibling_id is missing", async () => {
    const res = await POST(createRequest({}), params);
    expect(res.status).toBe(400);
    expect(mockVerifyAndDelete).not.toHaveBeenCalled();
  });

  test("returns 400 when sibling_id equals the anchor id", async () => {
    const res = await POST(createRequest({ sibling_id: "anchor-1" }), params);
    expect(res.status).toBe(400);
    expect(mockVerifyAndDelete).not.toHaveBeenCalled();
  });

  test("returns 422 when the target is not a verified sibling", async () => {
    mockVerifyAndDelete.mockRejectedValue(
      new DuplicateSiblingError("not a sibling", 422, "not_a_duplicate_sibling"),
    );
    const res = await POST(createRequest({ sibling_id: "evil-id" }), params);
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.reason).toBe("not_a_duplicate_sibling");
  });

  test("returns 200 and forwards the verified delete (agent path)", async () => {
    mockVerifyAndDelete.mockResolvedValue({
      deleted_id: "sib-1",
      anchor: {
        is_potential_duplicate: false,
        duplicate_count: 0,
        duplicate_siblings: [],
        has_uploaded_sibling: false,
      },
    });
    const res = await POST(createRequest({ sibling_id: "sib-1" }), params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.deleted_id).toBe("sib-1");

    expect(mockVerifyAndDelete).toHaveBeenCalledTimes(1);
    const callArgs = mockVerifyAndDelete.mock.calls[0][2];
    expect(callArgs).toMatchObject({
      anchorId: "anchor-1",
      targetId: "sib-1",
      actor: AGENT,
    });
  });

  test("maps a cross-market 403 from the lib", async () => {
    mockVerifyAndDelete.mockRejectedValue(
      new DuplicateSiblingError("Forbidden", 403, "not_permitted"),
    );
    const res = await POST(createRequest({ sibling_id: "sib-1" }), params);
    expect(res.status).toBe(403);
  });
});
