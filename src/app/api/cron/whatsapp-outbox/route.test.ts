import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mockDrain = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/whatsapp/outbox", () => ({ drainOutbox: (...a: unknown[]) => mockDrain(...a) }));

import { POST } from "./route";

const req = (headers: Record<string, string> = {}) => new NextRequest(new URL("http://localhost:3000/api/cron/whatsapp-outbox"), { method: "POST", headers });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "s3cret";
  mockDrain.mockResolvedValue({ run_id: "r", status: "succeeded", claimed: 2, sent: 2, failed: 0, skipped: 0, deferred: 0, released: 0 });
});
afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("POST /api/cron/whatsapp-outbox", () => {
  test("401 without the secret; drains with it and reports the counts", async () => {
    expect((await POST(req())).status).toBe(401);
    expect(mockDrain).not.toHaveBeenCalled();
    const res = await POST(req({ "x-cron-secret": "s3cret" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: "succeeded", sent: 2 });
    expect(mockDrain.mock.calls[0][1]).toMatchObject({ trigger: "cron" });
  });

  test("a failed run is a 500 so pg_net's response table shows it", async () => {
    mockDrain.mockResolvedValue({ run_id: "r", status: "failed", error: "claim failed", claimed: 0, sent: 0, failed: 0, skipped: 0, deferred: 0, released: 0 });
    const res = await POST(req({ Authorization: "Bearer s3cret" }));
    expect(res.status).toBe(500);
  });
});
