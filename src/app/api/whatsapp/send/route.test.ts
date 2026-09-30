import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { setTestActor, resetTestActor } from "@/test/helpers/actorMock";

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({ from: vi.fn() }),
  createClient: async () => ({ from: vi.fn(), rpc: vi.fn() }),
}));
vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});
const mockSend = vi.fn();
vi.mock("@/lib/whatsapp/send", async () => {
  const actual = await vi.importActual<typeof import("@/lib/whatsapp/send")>("@/lib/whatsapp/send");
  return { ...actual, sendMessage: (...a: unknown[]) => mockSend(...a) };
});

import { POST } from "./route";
import { SendError } from "@/lib/whatsapp/send";

const req = (body: unknown) =>
  new NextRequest(new URL("http://localhost:3000/api/whatsapp/send"), { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  vi.clearAllMocks();
  resetTestActor();
  setTestActor({ role: "agent", market_id: "m-1", id: "ag-1" });
  mockSend.mockResolvedValue({ id: "m-1", status: "sent", wamid: "wamid.1" });
});

describe("POST /api/whatsapp/send", () => {
  test("201 with the message row; the actor and both clients reach the service", async () => {
    const res = await POST(req({ target: { order_id: "o-1" }, language: "fr", mode: "template", template_id: "t-1" }));
    expect(res.status).toBe(201);
    expect((await res.json()).data).toMatchObject({ id: "m-1", wamid: "wamid.1" });
    const [ctx, body] = mockSend.mock.calls[0];
    expect(ctx.actor).toMatchObject({ id: "ag-1", role: "agent" });
    expect(ctx.admin).toBeTruthy();
    expect(ctx.user).toBeTruthy();
    expect(body).toMatchObject({ target: { order_id: "o-1" }, mode: "template" });
  });

  test("maps SendError to its status and code, keeping Meta's code and kind", async () => {
    mockSend.mockRejectedValue(new SendError(409, "opted_out"));
    let res = await POST(req({ target: { order_id: "o-1" }, language: "fr", mode: "text", text: "x" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("opted_out");
    mockSend.mockRejectedValue(new SendError(502, "graph_failed", "Undeliverable", { graphCode: 131026, kind: "undeliverable" }));
    res = await POST(req({ target: { order_id: "o-1" }, language: "fr", mode: "text", text: "x" }));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "graph_failed", code: 131026, kind: "undeliverable" });
  });

  test("400 on a body without a target; 403 for a warehouse agent; unknown errors are 500", async () => {
    expect((await POST(req({ language: "fr" }))).status).toBe(400);
    expect((await POST(req("{oops"))).status).toBe(400);
    setTestActor({ role: "warehouse_agent", market_id: "m-1" });
    expect((await POST(req({ target: { order_id: "o-1" }, language: "fr", mode: "text", text: "x" }))).status).toBe(403);
    setTestActor({ role: "agent", market_id: "m-1" });
    mockSend.mockRejectedValue(new Error("boom"));
    expect((await POST(req({ target: { order_id: "o-1" }, language: "fr", mode: "text", text: "x" }))).status).toBe(500);
  });
});
