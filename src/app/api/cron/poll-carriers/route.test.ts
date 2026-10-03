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

describe("handlePollCronRequest — the run is written to job_runs", () => {
  const ok = (n: Partial<{ polled: number; processed: number; ignored: number; errored: number }>) => ({
    carrierCode: "navex" as const,
    polled: 0,
    processed: 0,
    ignored: 0,
    errored: 0,
    ...n,
  });

  function journal() {
    const finish = vi.fn().mockResolvedValue(undefined);
    const startRun = vi.fn().mockResolvedValue({ finish });
    return { finish, startRun };
  }

  async function run(runCycle: () => Promise<unknown>, startRun: () => Promise<unknown>) {
    return handlePollCronRequest({
      headers: new Headers({ "x-cron-secret": "s3cret" }),
      expectedSecret: "s3cret",
      runCycle: runCycle as never,
      startRun: startRun as never,
    });
  }

  test("an unauthorised call opens no run", async () => {
    const { startRun } = journal();
    await handlePollCronRequest({
      headers: new Headers({ "x-cron-secret": "wrong" }),
      expectedSecret: "s3cret",
      runCycle: vi.fn(),
      startRun,
    });
    expect(startRun).not.toHaveBeenCalled();
  });

  test("nothing to poll → skipped", async () => {
    const { finish, startRun } = journal();
    await run(vi.fn().mockResolvedValue([]), startRun);
    expect(startRun).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledWith({
      status: "skipped",
      counters: { polled: 0, processed: 0, ignored: 0, errored: 0 },
      changed: 0,
      error: null,
    });
  });

  test("every parcel read → succeeded, changed = transitions applied", async () => {
    const { finish, startRun } = journal();
    await run(vi.fn().mockResolvedValue([ok({ polled: 5, processed: 3, ignored: 2 })]), startRun);
    expect(finish).toHaveBeenCalledWith({
      status: "succeeded",
      counters: { polled: 5, processed: 3, ignored: 2, errored: 0 },
      changed: 3,
      error: null,
    });
  });

  test("some parcels in error → partial", async () => {
    const { finish, startRun } = journal();
    await run(vi.fn().mockResolvedValue([ok({ polled: 5, processed: 3, errored: 2 })]), startRun);
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ status: "partial", changed: 3 }));
  });

  test("every parcel in error → failed (the carrier is down, not « partial »)", async () => {
    const { finish, startRun } = journal();
    await run(vi.fn().mockResolvedValue([ok({ polled: 4, errored: 4 })]), startRun);
    expect(finish).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", changed: 0, error: expect.stringContaining("4") }),
    );
  });

  test("a cycle that throws → failed with its message, the 500 answer unchanged", async () => {
    const { finish, startRun } = journal();
    const result = await run(vi.fn().mockRejectedValue(new Error("db down")), startRun);
    expect(result.status).toBe(500);
    expect(result.body.error).toContain("db down");
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", error: "db down" }));
  });

  test("a run row that cannot be written never changes the answer", async () => {
    const startRun = vi.fn().mockRejectedValue(new Error("journal down"));
    const fakeResults = [ok({ polled: 1, processed: 1 })];
    const result = await run(vi.fn().mockResolvedValue(fakeResults), startRun);
    expect(result.status).toBe(200);
    expect(result.body.results).toEqual(fakeResults);
  });

  test("a finish that rejects never changes the answer", async () => {
    const finish = vi.fn().mockRejectedValue(new Error("journal down"));
    const startRun = vi.fn().mockResolvedValue({ finish });
    const result = await run(vi.fn().mockResolvedValue([ok({ polled: 1, processed: 1 })]), startRun);
    expect(result.status).toBe(200);
  });
});
