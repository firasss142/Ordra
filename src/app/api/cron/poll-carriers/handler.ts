import type { PollRunResult } from "@/lib/carriers/polling/poller";
import type { JobRun, JobRunOutcome } from "@/lib/journal/job-run";

export interface CronRequestInput {
  headers: Headers;
  expectedSecret: string;
  runCycle: () => Promise<PollRunResult[]>;
  /**
   * Opens the job_runs row (Journaux). The handler closes it with what the
   * cycle really did. Optional, and never allowed to change the answer.
   */
  startRun?: () => Promise<JobRun>;
}

export interface CronResponse {
  status: number;
  body: {
    success?: boolean;
    results?: PollRunResult[];
    error?: string;
  };
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** What a poll cycle did, as a job_runs outcome. */
function pollOutcome(results: PollRunResult[]): JobRunOutcome {
  const counters = { polled: 0, processed: 0, ignored: 0, errored: 0 };
  for (const r of results) {
    counters.polled += r.polled;
    counters.processed += r.processed;
    counters.ignored += r.ignored;
    counters.errored += r.errored;
  }
  const status =
    counters.polled === 0
      ? "skipped"
      : counters.errored === 0
        ? "succeeded"
        : counters.errored === counters.polled
          ? "failed"
          : "partial";
  return {
    status,
    counters,
    changed: counters.processed,
    error: status === "failed" ? `${counters.errored}/${counters.polled} colis en erreur` : null,
  };
}

async function safely(fn: () => Promise<unknown> | undefined): Promise<void> {
  try {
    await fn();
  } catch {
    // job_runs is bookkeeping: it never turns a poll into an error.
  }
}

export async function handlePollCronRequest(
  input: CronRequestInput
): Promise<CronResponse> {
  if (!input.expectedSecret) {
    return { status: 500, body: { error: "CRON_SECRET not configured" } };
  }

  const provided = input.headers.get("x-cron-secret") ?? "";
  if (!timingSafeEqual(provided, input.expectedSecret)) {
    return { status: 401, body: { error: "Unauthorized" } };
  }

  let run: JobRun | null = null;
  await safely(async () => {
    run = (await input.startRun?.()) ?? null;
  });

  try {
    const results = await input.runCycle();
    await safely(() => run?.finish(pollOutcome(results)));
    return { status: 200, body: { success: true, results } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await safely(() => run?.finish({ status: "failed", error: message }));
    return { status: 500, body: { error: message } };
  }
}
