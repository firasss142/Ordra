/**
 * Voix du client — the fixed vocabulary (plans/voix-du-client.md, « Taxonomy »).
 *
 * Three categories BY INTENT, fixed by the owner on 2026-10-01; they are a Postgres enum and
 * drive the colour, the complaint lifecycle and the grouping. Topics under them are rows in
 * `feedback_topics`, per market.
 */

export const FEEDBACK_CATEGORIES = ["reclamation", "objection", "suggestion"] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

/** Where the customer's voice reached us — derived from the order status, never typed. */
export const FEEDBACK_MOMENTS = ["call", "transit", "door", "after"] as const;
export type FeedbackMoment = (typeof FEEDBACK_MOMENTS)[number];

/** Only a réclamation has a lifecycle. */
export const COMPLAINT_STATUSES = ["open", "in_progress", "resolved"] as const;
export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

export const FEEDBACK_SOURCES = ["agent", "rejection", "delivery", "courier", "import"] as const;
export type FeedbackSource = (typeof FEEDBACK_SOURCES)[number];

/** CHECK customer_feedback_body_length. */
export const FEEDBACK_BODY_MAX = 2000;

/** A complaint still open after this long is « sans réponse depuis plus de 48 h ». */
export const COMPLAINT_LATE_MS = 48 * 3_600_000;

export function isFeedbackCategory(v: unknown): v is FeedbackCategory {
  return typeof v === "string" && (FEEDBACK_CATEGORIES as readonly string[]).includes(v);
}

export function isComplaintStatus(v: unknown): v is ComplaintStatus {
  return typeof v === "string" && (COMPLAINT_STATUSES as readonly string[]).includes(v);
}

/** Open or being handled, and older than 48 h. */
export function isLateComplaint(
  row: { category: FeedbackCategory; status: string | null; created_at: string },
  now: number = Date.now(),
): boolean {
  return (
    row.category === "reclamation" &&
    (row.status === "open" || row.status === "in_progress") &&
    now - new Date(row.created_at).getTime() > COMPLAINT_LATE_MS
  );
}
