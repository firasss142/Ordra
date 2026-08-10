/**
 * Which sub-bucket an in-progress order belongs to.
 *
 * This exists because the queue used to answer that question in three places
 * with two different rules. `bucketForStatus` was time-blind and sent every
 * `callback_scheduled` / `dispatch_scheduled` row to "en cours", while each
 * sub-filter predicate rejected a future timestamp — so an order scheduled for
 * tomorrow rendered under "Tous" and matched no chip at all. The counts applied
 * the sub-filter rule and the list applied the bucket rule, so the "Tous" badge
 * also reported fewer rows than it showed.
 *
 * One function, one rule, and a test that the partition is total: every
 * en-cours order lands in exactly one bucket. Shape borrowed from
 * `lib/to-ship/group.ts`, which already models scheduling this way.
 */

export type EnCoursBucket = "tentative" | "rappel" | "livraison";

export const EN_COURS_BUCKETS: readonly EnCoursBucket[] = [
  "tentative",
  "rappel",
  "livraison",
] as const;

const ATTEMPT_STATUSES = new Set(["attempt_1", "attempt_2", "attempt_3"]);

export interface ScheduleInput {
  status: string;
  callback_scheduled_at?: string | null;
  scheduled_dispatch_at?: string | null;
  scheduled_dispatch_auto?: boolean | null;
}

export function isEnCoursStatus(status: string): boolean {
  return (
    ATTEMPT_STATUSES.has(status) ||
    status === "callback_scheduled" ||
    status === "dispatch_scheduled"
  );
}

/**
 * Returns null when the order is not in progress — `pending`, `confirmed` and
 * everything closed belong to other buckets entirely.
 *
 * A bucket answers *what kind of work* this is, not *when it is due*. An earlier
 * version split each kind in two — due-now versus scheduled-ahead — which meant
 * four chips for three kinds of work and made the agent check two places for
 * "my calls". Urgency is already carried where it belongs: the status pill turns
 * red and reads "en retard" the moment a scheduled time passes, and the queue
 * sort floats overdue callbacks to the top.
 *
 * `nowMs` is retained in the signature because callers pass one clock for a
 * whole pass and because time may become load-bearing again.
 */
export function enCoursBucket(o: ScheduleInput, _nowMs: number): EnCoursBucket | null {
  if (ATTEMPT_STATUSES.has(o.status)) return "tentative";
  if (o.status === "callback_scheduled") return "rappel";
  if (o.status === "dispatch_scheduled") return "livraison";
  return null;
}
