/**
 * Length caps for the agent-facing product sheet, shared by the write route
 * and the authoring form so the client counter and the server validation can
 * never disagree.
 *
 * Lives outside the route file because Next.js only allows a fixed set of
 * exports from a route module.
 */

/** The pinned must-know is read mid-call — it has to stay one line. */
export const AGENT_BRIEF_MAX = 280;

export const AGENT_NOTES_MAX = 4000;

export const VARIANT_NOTE_MAX = 160;
