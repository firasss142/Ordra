import { describe, test, expect, vi } from "vitest";
import { handleRateHarvestCronRequest } from "./handler";
import type { HarvestRunSummary } from "@/lib/carriers/darb-rate-harvest";

const COMPLETED: HarvestRunSummary = {
  requested: 556,
  succeeded: 556,
  failed: 0,
  skipped: 0,
  circuitOpened: false,
  status: "completed",
};

function headers(secret?: string): Headers {
  const h = new Headers();
  if (secret !== undefined) h.set("x-cron-secret", secret);
  return h;
}

describe("handleRateHarvestCronRequest", () => {
  test("500 when CRON_SECRET is not configured", async () => {
    const res = await handleRateHarvestCronRequest({
      headers: headers("anything"),
      expectedSecret: "",
      limit: 600,
      runHarvestCycle: vi.fn(),
    });
    expect(res.status).toBe(500);
  });

  test("401 on a wrong secret", async () => {
    const runHarvestCycle = vi.fn();
    const res = await handleRateHarvestCronRequest({
      headers: headers("nope"),
      expectedSecret: "s3cret",
      limit: 600,
      runHarvestCycle,
    });
    expect(res.status).toBe(401);
    expect(runHarvestCycle).not.toHaveBeenCalled();
  });

  test("401 when the header is absent", async () => {
    const res = await handleRateHarvestCronRequest({
      headers: headers(),
      expectedSecret: "s3cret",
      limit: 600,
      runHarvestCycle: vi.fn(),
    });
    expect(res.status).toBe(401);
  });

  test("200 with the run summary", async () => {
    const res = await handleRateHarvestCronRequest({
      headers: headers("s3cret"),
      expectedSecret: "s3cret",
      limit: 600,
      runHarvestCycle: vi.fn().mockResolvedValue(COMPLETED),
    });
    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual(COMPLETED);
  });

  test("passes the limit through to the cycle", async () => {
    const runHarvestCycle = vi.fn().mockResolvedValue(COMPLETED);
    await handleRateHarvestCronRequest({
      headers: headers("s3cret"),
      expectedSecret: "s3cret",
      limit: 120,
      runHarvestCycle,
    });
    expect(runHarvestCycle).toHaveBeenCalledWith(120);
  });

  // A partial run must not make the scheduler retry-storm: the run itself
  // succeeded, some cells didn't. The detail lives in the summary.
  test("200 with status partial when some cells failed", async () => {
    const partial: HarvestRunSummary = {
      ...COMPLETED,
      succeeded: 540,
      failed: 16,
      status: "partial",
    };
    const res = await handleRateHarvestCronRequest({
      headers: headers("s3cret"),
      expectedSecret: "s3cret",
      limit: 600,
      runHarvestCycle: vi.fn().mockResolvedValue(partial),
    });
    expect(res.status).toBe(200);
    expect(res.body.summary?.status).toBe("partial");
  });

  test("500 without leaking the vendor api key when the cycle throws", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handleRateHarvestCronRequest({
      headers: headers("s3cret"),
      expectedSecret: "s3cret",
      limit: 600,
      runHarvestCycle: vi
        .fn()
        .mockRejectedValue(new Error("401 for apikey sk_live_SUPERSECRET")),
    });
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("sk_live_SUPERSECRET");
    expect(JSON.stringify(res.body)).not.toContain("apikey");
    spy.mockRestore();
  });
});
