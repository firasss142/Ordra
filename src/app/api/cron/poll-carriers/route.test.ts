import { describe, test, expect, vi, beforeEach } from "vitest";
import { handlePollCronRequest } from "./handler";

describe("handlePollCronRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns 401 when x-cron-secret header is missing", async () => {
    const result = await handlePollCronRequest({
      headers: new Headers(),
      expectedSecret: "s3cret",
      runCycle: vi.fn(),
    });
    expect(result.status).toBe(401);
    expect(result.body.error).toBeDefined();
  });

  test("returns 401 when x-cron-secret does not match", async () => {
    const result = await handlePollCronRequest({
      headers: new Headers({ "x-cron-secret": "wrong" }),
      expectedSecret: "s3cret",
      runCycle: vi.fn(),
    });
    expect(result.status).toBe(401);
  });

  test("returns 500 when CRON_SECRET env var is not configured", async () => {
    const result = await handlePollCronRequest({
      headers: new Headers({ "x-cron-secret": "anything" }),
      expectedSecret: "",
      runCycle: vi.fn(),
    });
    expect(result.status).toBe(500);
  });

  test("returns 200 with results when secret is valid", async () => {
    const fakeResults = [
      { carrierCode: "navex" as const, polled: 3, processed: 2, ignored: 1, errored: 0 },
      { carrierCode: "dexpress" as const, polled: 2, processed: 2, ignored: 0, errored: 0 },
    ];
    const runCycle = vi.fn().mockResolvedValue(fakeResults);

    const result = await handlePollCronRequest({
      headers: new Headers({ "x-cron-secret": "s3cret" }),
      expectedSecret: "s3cret",
      runCycle,
    });

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.results).toEqual(fakeResults);
    expect(runCycle).toHaveBeenCalledTimes(1);
  });

  test("returns 500 when runCycle throws", async () => {
    const runCycle = vi.fn().mockRejectedValue(new Error("db down"));
    const result = await handlePollCronRequest({
      headers: new Headers({ "x-cron-secret": "s3cret" }),
      expectedSecret: "s3cret",
      runCycle,
    });
    expect(result.status).toBe(500);
    expect(result.body.error).toContain("db down");
  });
});
