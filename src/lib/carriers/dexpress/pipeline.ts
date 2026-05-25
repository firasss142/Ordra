/**
 * Pipeline classification for the Dexpress status timeline UI.
 *
 * The 19-status taxonomy includes a happy-path lifecycle plus several off-path
 * branches (returns, refusals, postponements). For the order panel's timeline,
 * we render 5 happy-path nodes with off-path slugs inserted as a single branch
 * node when reached. Sub-states (e.g. branch-movement IN_COMPANY → branches →
 * SENT_TO_COURIER) collapse into their nearest happy-path parent so the
 * timeline stays readable.
 */

import type { DexpressSlug } from "./statuses";

/**
 * The 5 happy-path nodes, in order. Every successful order traverses these.
 */
export const HAPPY_PATH: readonly DexpressSlug[] = [
  "BEING_PREPARED",
  "IN_COMPANY",
  "SENT_TO_COURIER",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
] as const;

/**
 * Slugs that should collapse into a happy-path node for timeline rendering.
 * (E.g. while the order is bouncing between Dexpress's regional branches we
 * still show it as "in the company" — the user cares about the macro stage,
 * not the sub-state.)
 */
const COLLAPSE_TO_HAPPY: Partial<Record<DexpressSlug, DexpressSlug>> = {
  WILL_BE_SENT_TO_BRANCHES: "IN_COMPANY",
  EN_ROUTE_TO_BRANCHES: "IN_COMPANY",
  ARRIVED_AT_BRANCHES: "IN_COMPANY",
  AWAITING_COURIER_SETTLEMENT: "SENT_TO_COURIER",
};

/**
 * Slugs that are visible *failures or off-path branches*. When the current
 * status is one of these, the timeline shows the happy-path up to the
 * divergence point, then a single "branch" node carrying this slug.
 */
const OFF_PATH: ReadonlySet<DexpressSlug> = new Set<DexpressSlug>([
  "AT_CUSTOMER",
  "DELIVERY_POSTPONED",
  "POSTPONED_WITH_COURIER",
  "PARTIALLY_DELIVERED",
  "REPLACED",
  "RECEIPT_REFUSED",
  "RETURNING_VIA_COURIER",
  "RETURNING_AT_BRANCHES",
  "RETURNING_TO_COMPANY",
  "RETURNED_AT_COMPANY",
]);

export type NodeState = "past" | "current" | "future";

export interface TimelineNode {
  slug: DexpressSlug;
  state: NodeState;
  /** True for the off-path branch node. False for happy-path nodes. */
  branch: boolean;
}

/**
 * Build the ordered list of timeline nodes for a given current slug.
 *
 * Rules:
 *  - If currentSlug is on the happy path → 5 nodes, exactly one is "current",
 *    everything before it is "past", everything after is "future".
 *  - If currentSlug collapses to a happy-path node → same as above using the
 *    collapsed target (e.g. EN_ROUTE_TO_BRANCHES renders as IN_COMPANY current).
 *  - If currentSlug is off-path → happy-path nodes BEFORE the diverge point
 *    are "past" (including DELIVERED if the order somehow reached delivered
 *    then went off-path, which shouldn't happen but we don't lock it out),
 *    then a "current" branch node for the off-path slug, then nothing else
 *    (the order is unlikely to ever reach DELIVERED from a returning branch).
 *  - If currentSlug is null/unknown → return just a single "current" branch
 *    node with the unknown marker. Caller decides how to render it.
 */
export function buildTimeline(
  currentSlug: DexpressSlug | null,
): TimelineNode[] {
  if (currentSlug === null) {
    // Caller renders "unrecognized" — no timeline shape available.
    return [];
  }

  // Collapse sub-states into their happy-path parent before doing anything else.
  const effective = COLLAPSE_TO_HAPPY[currentSlug] ?? currentSlug;

  // Happy path (most common case).
  if ((HAPPY_PATH as readonly string[]).includes(effective)) {
    const idx = HAPPY_PATH.indexOf(effective as DexpressSlug);
    return HAPPY_PATH.map((slug, i) => ({
      slug,
      state: i < idx ? "past" : i === idx ? "current" : "future",
      branch: false,
    }));
  }

  // Off-path. Where in the happy path did the order diverge?
  //   - AT_CUSTOMER ≈ pre-prep, so no past nodes (rare flow).
  //   - Postponements/refused happen during OUT_FOR_DELIVERY.
  //   - Returning happens after OUT_FOR_DELIVERY.
  if (OFF_PATH.has(effective)) {
    const divergeAfter = divergencePoint(effective);
    const happyPastCount = divergeAfter + 1; // nodes 0..divergeAfter are past
    const nodes: TimelineNode[] = HAPPY_PATH.slice(0, happyPastCount).map(
      (slug) => ({ slug, state: "past", branch: false }),
    );
    nodes.push({ slug: effective, state: "current", branch: true });
    return nodes;
  }

  // Unknown taxonomy ID that somehow has a slug — same as null fallback.
  return [];
}

/**
 * Per-slug current-node color for the timeline. Each color tells a small story
 * about the order's state. Statuses in the same conceptual group share a color:
 *
 *   indigo  → BEING_PREPARED            (initial activity)
 *   teal    → IN_COMPANY family         (warehouse hold)
 *   cyan    → SENT_TO_COURIER family    (in courier custody, not yet moving)
 *   purple  → OUT_FOR_DELIVERY          (high-energy active delivery)
 *   green   → DELIVERED                 (terminal success)
 *   amber   → AT_CUSTOMER / PARTIAL / REPLACED  (customer-facing variations)
 *   orange  → POSTPONED family          (delayed, recoverable)
 *   red     → RECEIPT_REFUSED           (hard fail)
 *   rose    → RETURNING family          (reversed, in motion)
 *   darkRed → RETURNED_AT_COMPANY       (returned, terminal)
 *
 * Past nodes and connectors are rendered in muted gray ("validated, done")
 * regardless of the current color — the story color is owned exclusively by
 * the current node ring.
 */
export const SLUG_COLOR: Record<DexpressSlug, string> = {
  BEING_PREPARED: "#4F46E5", // indigo
  IN_COMPANY: "#0D9488", // teal
  WILL_BE_SENT_TO_BRANCHES: "#0D9488",
  EN_ROUTE_TO_BRANCHES: "#0D9488",
  ARRIVED_AT_BRANCHES: "#0D9488",
  SENT_TO_COURIER: "#0891B2", // cyan
  AWAITING_COURIER_SETTLEMENT: "#0891B2",
  OUT_FOR_DELIVERY: "#7C3AED", // purple
  DELIVERED: "#008060", // green
  AT_CUSTOMER: "#B98900", // amber
  PARTIALLY_DELIVERED: "#B98900",
  REPLACED: "#B98900",
  DELIVERY_POSTPONED: "#EA580C", // orange
  POSTPONED_WITH_COURIER: "#EA580C",
  RECEIPT_REFUSED: "#D72C0D", // red
  RETURNING_VIA_COURIER: "#E11D48", // rose
  RETURNING_AT_BRANCHES: "#E11D48",
  RETURNING_TO_COMPANY: "#E11D48",
  RETURNED_AT_COMPANY: "#9F1239", // dark red
};

export function colorForSlug(slug: DexpressSlug): string {
  return SLUG_COLOR[slug];
}

/**
 * For an off-path slug, return the index of the happy-path node where the
 * order most likely was just before going off-path. The branch node sits
 * after this index. Returns -1 if the order never reached the first node
 * (e.g. AT_CUSTOMER may indicate the order was never prepared by Dexpress).
 */
function divergencePoint(offPath: DexpressSlug): number {
  switch (offPath) {
    case "AT_CUSTOMER":
      return -1; // Renders with no happy-path past, just the branch node.
    case "DELIVERY_POSTPONED":
    case "POSTPONED_WITH_COURIER":
    case "RECEIPT_REFUSED":
    case "PARTIALLY_DELIVERED":
    case "REPLACED":
      // Diverged from OUT_FOR_DELIVERY (index 3).
      return 3;
    case "RETURNING_VIA_COURIER":
    case "RETURNING_AT_BRANCHES":
    case "RETURNING_TO_COMPANY":
    case "RETURNED_AT_COMPANY":
      // Returning means it definitely reached OUT_FOR_DELIVERY and didn't
      // deliver — show all 4 pre-DELIVERED nodes as past.
      return 3;
    default:
      return -1;
  }
}
