import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { setTestActor, resetTestActor } from "@/test/helpers/actorMock";

const mockRpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({}),
  createClient: async () => ({ rpc: mockRpc }),
}));
vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});

import { POST } from "./route";

const req = () => new NextRequest(new URL("http://localhost:3000/api/whatsapp/conversations/c-1/read"), { method: "POST" });
const params = { params: { id: "c-1" } };

beforeEach(() => {
  vi.clearAllMocks();
  resetTestActor();
  setTestActor({ role: "agent", market_id: "m-1" });
});

describe("POST /api/whatsapp/conversations/[id]/read", () => {
  test("calls the RPC as the session user and returns the cleared count", async () => {
    mockRpc.mockResolvedValue({ data: 1, error: null });
    const res = await POST(req(), params);
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("whatsapp_mark_conversation_read", { p_conversation_id: "c-1" });
    expect((await res.json()).data).toEqual({ cleared: 1 });
  });

  test("maps the RPC's refusal codes", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "42501", message: "nope" } });
    expect((await POST(req(), params)).status).toBe(403);
    mockRpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "nope" } });
    expect((await POST(req(), params)).status).toBe(404);
  });
});
