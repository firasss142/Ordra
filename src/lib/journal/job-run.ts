/**
 * Run bookkeeping for the two crons that had none → public.job_runs
 * (plans/journaux-redesign.md §3.2).
 *
 * pg_cron says « succeeded » as soon as the HTTP call is queued, whatever the
 * route then did. A run row is opened 'running' at the start and closed with
 * what the run really did. Writing it must never make the cron fail: every
 * error is swallowed, and a run that could not be opened is simply not closed
 * (journal_reap_runs() closes rows left 'running').
 */

export type JobName = "poll-carriers" | "dispatch-scheduled";
export type JobRunStatus = "succeeded" | "partial" | "failed" | "skipped";

export interface JobRunOutcome {
  status: JobRunStatus;
  counters?: Record<string, number>;
  /** Orders the run actually changed. */
  changed?: number;
  error?: string | null;
}

export interface JobRun {
  finish(outcome: JobRunOutcome): Promise<void>;
}

type JobRunsClient = {
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => {
      select: (cols: string) => { single: () => PromiseLike<{ data: unknown; error: unknown }> };
    };
    update: (row: Record<string, unknown>) => { eq: (col: string, value: string) => PromiseLike<unknown> };
  };
};

const ERROR_MAX = 500;

export async function startJobRun(admin: JobRunsClient, job: JobName): Promise<JobRun> {
  let id: string | null = null;
  try {
    const { data } = await admin.from("job_runs").insert({ job, status: "running" }).select("id").single();
    id = (data as { id?: string } | null)?.id ?? null;
  } catch {
    id = null;
  }

  return {
    async finish(outcome) {
      if (!id) return;
      try {
        await admin
          .from("job_runs")
          .update({
            status: outcome.status,
            finished_at: new Date().toISOString(),
            counters: outcome.counters ?? {},
            changed: outcome.changed ?? 0,
            error: outcome.error ? outcome.error.slice(0, ERROR_MAX) : null,
          })
          .eq("id", id);
      } catch {
        // The run row is bookkeeping; the cron's own answer comes first.
      }
    },
  };
}
