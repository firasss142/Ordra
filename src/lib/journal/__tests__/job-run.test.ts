import { describe, test, expect, vi } from "vitest";
import { startJobRun } from "../job-run";

type Admin = Parameters<typeof startJobRun>[0];

/**
 * A service-role double for job_runs: `insert(...).select("id").single()` opens
 * the run, `update(...).eq("id", id)` closes it.
 */
function fakeAdmin(opts: {
  insertResult?: Promise<unknown>;
  updateResult?: Promise<unknown>;
} = {}) {
  const single = vi.fn(() => opts.insertResult ?? Promise.resolve({ data: { id: "run-1" }, error: null }));
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  const eq = vi.fn(() => opts.updateResult ?? Promise.resolve({ error: null }));
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ insert, update }));
  return { admin: { from } as unknown as Admin, from, insert, update, eq };
}

describe("startJobRun", () => {
  test("opens a 'running' row for the job", async () => {
    const { admin, from, insert } = fakeAdmin();
    await startJobRun(admin, "poll-carriers");
    expect(from).toHaveBeenCalledWith("job_runs");
    expect(insert).toHaveBeenCalledWith({ job: "poll-carriers", status: "running" });
  });

  test("finish closes that same row with the real outcome", async () => {
    const { admin, update, eq } = fakeAdmin();
    const run = await startJobRun(admin, "dispatch-scheduled");
    await run.finish({ status: "partial", counters: { ready: 3, uploaded: 2, failed: 1 }, changed: 2, error: null });
    expect(update).toHaveBeenCalledWith({
      status: "partial",
      finished_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      counters: { ready: 3, uploaded: 2, failed: 1 },
      changed: 2,
      error: null,
    });
    expect(eq).toHaveBeenCalledWith("id", "run-1");
  });

  test("a long error is cut so a stack trace never fills the row", async () => {
    const { admin, update } = fakeAdmin();
    const run = await startJobRun(admin, "poll-carriers");
    await run.finish({ status: "failed", error: "boom ".repeat(400) });
    const row = (update.mock.calls[0] as unknown[])[0] as { error: string };
    expect(row.error.length).toBeLessThanOrEqual(500);
  });

  test("when the run could not be opened, finish writes nothing and does not throw", async () => {
    const { admin, update } = fakeAdmin({ insertResult: Promise.resolve({ data: null, error: { message: "denied" } }) });
    const run = await startJobRun(admin, "poll-carriers");
    await expect(run.finish({ status: "succeeded" })).resolves.toBeUndefined();
    expect(update).not.toHaveBeenCalled();
  });

  test("an insert that rejects never reaches the cron", async () => {
    const { admin } = fakeAdmin({ insertResult: Promise.reject(new Error("db down")) });
    const run = await startJobRun(admin, "poll-carriers");
    await expect(run.finish({ status: "succeeded" })).resolves.toBeUndefined();
  });

  test("an update that rejects never reaches the cron", async () => {
    const { admin } = fakeAdmin({ updateResult: Promise.reject(new Error("db down")) });
    const run = await startJobRun(admin, "poll-carriers");
    await expect(run.finish({ status: "succeeded" })).resolves.toBeUndefined();
  });

  test("a client that throws synchronously never reaches the cron", async () => {
    const admin = { from: () => { throw new TypeError("not a client"); } } as unknown as Admin;
    const run = await startJobRun(admin, "dispatch-scheduled");
    await expect(run.finish({ status: "failed", error: "x" })).resolves.toBeUndefined();
  });
});
