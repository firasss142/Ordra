/**
 * Validation for the per-agent percentage split.
 *
 * Pure on purpose: the settings screen disables its Save button with exactly
 * the function the PUT route refuses with, so what the manager is told and
 * what the server enforces cannot drift apart.
 *
 * Why this is not a database constraint: the rule spans rows in a table, which
 * needs a statement-level trigger, and then "remove an agent" fails with a
 * constraint violation instead of doing the obvious thing. The rule lives here
 * and in the UI; the table only bounds each individual value.
 */

/** Shares are absolute targets, so the column must cover the whole day. */
export const SHARES_TOTAL = 100;

/** numeric(5,2) in the database — more precision would be silently rounded. */
const DECIMAL_PLACES = 2;

export type ShareError =
  | { code: "TOTAL_NOT_100"; total: number }
  | { code: "AGENT_UNCOVERED"; agentId: string }
  | { code: "AGENT_UNKNOWN"; agentId: string }
  | { code: "SHARE_OUT_OF_RANGE"; agentId: string; value: number }
  | { code: "SHARE_PRECISION"; agentId: string; value: number }
  | { code: "SHARE_NOT_A_NUMBER"; agentId: string };

export interface ShareValidation {
  valid: boolean;
  errors: ShareError[];
}

/**
 * Sum rounded to the stored precision.
 *
 * 33.33 + 33.33 + 33.34 is 100.00000000000001 in IEEE754, which would reject a
 * split the manager typed correctly. Round to what the column actually stores
 * before comparing.
 */
export function sharesTotal(shares: Record<string, number>): number {
  const raw = Object.values(shares).reduce(
    (sum, value) => (Number.isFinite(value) ? sum + value : sum),
    0,
  );
  return roundTo(raw, DECIMAL_PLACES);
}

function roundTo(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function hasTooMuchPrecision(value: number): boolean {
  return roundTo(value, DECIMAL_PLACES) !== value;
}

/**
 * @param shares       agent_id -> percentage, as the manager typed it
 * @param activeAgentIds every agent who can currently receive orders in this
 *                       market (active, not soft-deleted)
 */
export function validateShares(
  shares: Record<string, number>,
  activeAgentIds: string[],
): ShareValidation {
  const errors: ShareError[] = [];
  const active = new Set(activeAgentIds);

  for (const agentId of activeAgentIds) {
    if (!(agentId in shares)) {
      // Blocked rather than defaulted to 0: a new hire given no number would
      // otherwise receive nothing, and nobody would find out from the UI.
      errors.push({ code: "AGENT_UNCOVERED", agentId });
    }
  }

  for (const [agentId, value] of Object.entries(shares)) {
    if (!active.has(agentId)) {
      // Users are soft-deleted, so a departed agent's row survives and would
      // keep claiming a percentage of every day.
      errors.push({ code: "AGENT_UNKNOWN", agentId });
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      errors.push({ code: "SHARE_NOT_A_NUMBER", agentId });
      continue;
    }
    if (value < 0 || value > 100) {
      errors.push({ code: "SHARE_OUT_OF_RANGE", agentId, value });
      continue;
    }
    if (hasTooMuchPrecision(value)) {
      errors.push({ code: "SHARE_PRECISION", agentId, value });
    }
  }

  // A market with no agents has nothing to split; demanding 100 there would
  // make the screen unsaveable before the first hire.
  const expectsATotal = activeAgentIds.length > 0;
  if (expectsATotal && errors.length === 0) {
    const total = sharesTotal(shares);
    if (total !== SHARES_TOTAL) {
      errors.push({ code: "TOTAL_NOT_100", total });
    }
  }

  return { valid: errors.length === 0, errors };
}
