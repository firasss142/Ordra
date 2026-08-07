import type { StatusGlyphShape } from "@/components/shared/StatusGlyph";

/**
 * How an order status should look, in one place.
 *
 * Three things were wrong with the two `STATUS_TONE` maps this replaces (one in
 * `OrderRow`, a near-copy in the detail panel):
 *
 * 1. **The colour hierarchy was inverted.** On the newest 100 orders, 35% were
 *    `uploaded` (blue) and 28% `rejected` (red) — both settled, neither wanting
 *    anything from anyone — while `pending` (18%) sat in a grey outline that
 *    read as disabled. Red on a quarter of the rows is not a signal, it is the
 *    background.
 * 2. **One blue meant seven states**, so "Confirmé" (phase 1 done, still the
 *    agent's problem) was indistinguishable from "Téléchargé" (gone to the
 *    carrier). The two-phase model is the spine of this system.
 * 3. **Colour was the only encoding.** In greyscale every pill was the same
 *    object.
 *
 * Three orthogonal encodings, so no single one carries the whole load:
 *
 *   hue    — which phase and which outcome. Warm (neutral/amber/violet) while
 *            the order is in the confirmation phase, cool (teal/green) once it
 *            is with the carrier. Red for an unsuccessful ending.
 *   shape  — open or closed. Round means someone still owes this customer an
 *            action; angular means it is handed off or finished.
 *   weight — how much it wants you right now.
 *
 * Shape deliberately encodes open/closed rather than phase, because the shape
 * vocabulary has no round success mark and forcing one would have made the
 * family inconsistent. Phase is already unmistakable from hue: nothing in the
 * confirmation phase is teal, and nothing after it is violet.
 */

export type StatusHue = "neutral" | "amber" | "violet" | "teal" | "green" | "red";
export type StatusWeight = "quiet" | "medium" | "loud";

export interface StatusPresentation {
  hue: StatusHue;
  weight: StatusWeight;
  glyph: StatusGlyphShape;
  /** e.g. "3/8" — present only on attempt statuses. */
  counter: string | null;
}

/** Round shapes mean the order is still open — someone owes an action. */
export const OPEN_GLYPHS = new Set<StatusGlyphShape>(["ring", "solid", "half"]);

/** Hues that only ever appear once the order has left the agent's hands. */
export const FULFILLMENT_HUES = new Set<StatusHue>(["teal", "green"]);

/** Phase 1 — confirmation. Mirrors CALL_STATUSES in OrdersFacetBar. */
export const CONFIRMATION_STATUSES = [
  "pending",
  "new",
  "assigned",
  "attempt_1",
  "attempt_2",
  "attempt_3",
  "callback_scheduled",
] as const;

/** Phase 2 — fulfillment. Mirrors DELIVERY_STATUSES in OrdersFacetBar. */
export const FULFILLMENT_STATUSES = [
  "uploaded",
  "scanned",
  "dispatched",
  "deposit",
  "in_transit",
  "delivered",
  "returned",
  "to_be_returned",
  "received",
] as const;

type Base = Omit<StatusPresentation, "counter">;

const BASE: Record<string, Base> = {
  // ── Phase 1: someone still owes this customer a call ──────────────────
  pending: { hue: "neutral", weight: "medium", glyph: "ring" },
  new: { hue: "neutral", weight: "medium", glyph: "ring" },
  assigned: { hue: "neutral", weight: "medium", glyph: "ring" },
  attempt_1: { hue: "amber", weight: "medium", glyph: "solid" },
  attempt_2: { hue: "amber", weight: "medium", glyph: "solid" },
  attempt_3: { hue: "amber", weight: "medium", glyph: "solid" },
  // Scheduled is planned waiting — a different thing from nobody having called.
  callback_scheduled: { hue: "violet", weight: "medium", glyph: "half" },
  unverified: { hue: "amber", weight: "medium", glyph: "half" },

  // Phase 1 outcomes. Confirmed is violet and round: the order has NOT left
  // the agent's hands yet — the carrier upload is a separate action.
  confirmed: { hue: "violet", weight: "medium", glyph: "check" },
  dispatch_scheduled: { hue: "violet", weight: "quiet", glyph: "check" },

  // ── Phase 2: with the carrier, or finished ────────────────────────────
  uploaded: { hue: "teal", weight: "quiet", glyph: "square" },
  scanned: { hue: "teal", weight: "quiet", glyph: "square" },
  dispatched: { hue: "teal", weight: "quiet", glyph: "square" },
  deposit: { hue: "teal", weight: "quiet", glyph: "square" },
  received: { hue: "teal", weight: "quiet", glyph: "square" },
  in_transit: { hue: "teal", weight: "medium", glyph: "square" },
  delivered: { hue: "green", weight: "quiet", glyph: "check" },

  // Settled and unsuccessful. Red, but quiet: rejection is a normal COD
  // outcome on a quarter of orders, not an emergency on a quarter of orders.
  rejected: { hue: "red", weight: "quiet", glyph: "cross" },
  cancelled: { hue: "red", weight: "quiet", glyph: "cross" },
  returned: { hue: "red", weight: "quiet", glyph: "square" },
  // Not settled — a return still has to be organised by a person.
  to_be_returned: { hue: "amber", weight: "medium", glyph: "square" },
  deleted: { hue: "neutral", weight: "quiet", glyph: "square" },
};

/** A status the backend invented after this map was written. */
const UNKNOWN: Base = { hue: "neutral", weight: "quiet", glyph: "square" };

export interface StatusContext {
  /** Truth for how many calls were made — the status label caps at 3. */
  attemptsCount?: number | null;
  /** The market's `max_call_attempts`. Omitted until settings load. */
  maxAttempts?: number | null;
}

export function presentStatus(status: string, ctx: StatusContext = {}): StatusPresentation {
  const base = BASE[status] ?? UNKNOWN;
  const isAttempt = status.startsWith("attempt_");

  // The status enum stops at attempt_3 while max_call_attempts is configurable
  // (8 in Libya), so attempts_count is the only honest source past three.
  //
  // Zero is treated as absent, not as a count: an order cannot be in attempt_2
  // having made no calls, so a 0 there is a data artifact and the status digit
  // is the better truth. Rendering it literally produced "Tentative 0/9".
  const fromStatus = Number(status.slice("attempt_".length)) || null;
  const attempts = isAttempt
    ? ctx.attemptsCount && ctx.attemptsCount > 0
      ? ctx.attemptsCount
      : fromStatus
    : null;

  const max = ctx.maxAttempts ?? null;
  const counter =
    attempts === null ? null : max ? `${attempts}/${max}` : String(attempts);

  // Loud is reserved for a live problem: attempts spent, order still open.
  // A settled order is never loud, however many times it was called.
  const outOfAttempts =
    isAttempt && attempts !== null && max !== null && attempts >= max;

  return {
    ...base,
    weight: outOfAttempts ? "loud" : base.weight,
    counter,
  };
}
