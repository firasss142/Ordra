import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssignmentAlgorithm } from "@/types/settings";
import type { AssignableOrder, AssignmentContext, AvailableAgent } from "./auto-assignment-types";
import { selectAgent } from "./auto-assignment";
import { fetchAgentCapacity } from "./agent-capacity";
import { isReadyForOrders } from "./agent-readiness";

const ALGORITHM_NOTES: Record<string, string> = {
  round_robin: "Auto-assigned via Tour de rôle",
  workload: "Auto-assigned via Charge de travail",
  product_based: "Auto-assigned via Règle produit",
  region_based: "Auto-assigned via Règle région",
  percentage: "Auto-assigned via Répartition par pourcentages",
};

/**
 * Load the per-agent percentage split for a market.
 *
 * Returns `{}` when the table is empty or unreadable, which makes
 * `selectByPercentage` return null and leaves the order in the pool — the
 * right failure for "the manager has not configured this yet".
 */
export async function fetchAgentShares(
  adminClient: SupabaseClient,
  marketId: string
): Promise<Record<string, number>> {
  const { data, error } = await adminClient
    .from("agent_distribution_shares")
    .select("agent_id, share_pct")
    .eq("market_id", marketId);

  if (error || !data) return {};

  const shares: Record<string, number> = {};
  for (const row of data as Array<{ agent_id: string; share_pct: number | string }>) {
    const pct = typeof row.share_pct === "string" ? Number(row.share_pct) : row.share_pct;
    if (Number.isFinite(pct)) shares[row.agent_id] = pct;
  }
  return shares;
}

/**
 * Build the runtime inputs the percentage engine needs.
 *
 * `totalAssignedToday` is summed over EVERY agent the market has, not only the
 * ready ones. That is what makes the quota strict rather than pro-rata: an
 * agent who worked this morning and then went offline still contributes to the
 * denominator, so everyone's absolute target reflects the real volume and the
 * absent agent's deficit is repaid when they come back.
 *
 * (An agent deactivated mid-day drops out of `fetchAgentCapacity` and so out
 * of the denominator. Rare, and it only shifts targets by that agent's share
 * of one day.)
 */
export function buildPercentageContext(
  allAgents: AvailableAgent[],
  shares: Record<string, number>
): AssignmentContext {
  return {
    shares,
    totalAssignedToday: allAgents.reduce((sum, a) => sum + a.assigned_today, 0),
  };
}

export async function tryAutoAssign(
  adminClient: SupabaseClient,
  order: AssignableOrder
): Promise<void> {
  try {
    const [{ data: settingsRow }, { data: rule }] = await Promise.all([
      adminClient
        .from("settings")
        .select("value")
        .eq("market_id", order.market_id)
        .eq("key", "assignment_algorithm")
        .maybeSingle(),
      adminClient
        .from("assignment_rules")
        .select("algorithm, config, is_active")
        .eq("market_id", order.market_id)
        .maybeSingle(),
    ]);

    // Two storage shapes in the wild: the settings PATCH wraps scalars as
    // `{ value }`, PUT /api/assignment-rules writes `{ type }`.
    const algorithmValue = settingsRow?.value as { type?: string; value?: string } | undefined;
    const algorithm = (algorithmValue?.type ?? algorithmValue?.value) as
      | AssignmentAlgorithm
      | undefined;
    if (!algorithm || algorithm === "manual") return;

    if (!rule || !rule.is_active) return;

    const allAgents = await fetchAgentCapacity(adminClient, order.market_id);

    // Readiness gates EVERY algorithm, not just percentage: no algorithm
    // should push work at someone who has not said they are working.
    //
    // This replaces the old `active_agents_only` setting, which claimed in the
    // UI to mean "agents en ligne — jamais hors ligne" while actually checking
    // "acted today", and then silently fell back to all active agents when
    // nobody qualified. Readiness is the honest version of that intent.
    const now = new Date();
    const agents = allAgents.filter((a) => isReadyForOrders(a, now));

    // Nobody ready: the order stays `pending` and unassigned in the pool, and
    // is drained when someone declares themselves ready. This is a real
    // behaviour change — before, an order always landed on somebody.
    if (agents.length === 0) return;

    const context =
      algorithm === "percentage"
        ? buildPercentageContext(allAgents, await fetchAgentShares(adminClient, order.market_id))
        : undefined;

    const decision = selectAgent(order, agents, algorithm, rule.config, context, now);
    if (!decision) return;

    await adminClient.rpc("assign_order", {
      p_order_id: order.id,
      p_agent_id: decision.agent_id,
      p_actor_id: null,
      p_actor_type: "system",
      p_note: ALGORITHM_NOTES[algorithm] ?? "Auto-assigned",
    });

    // Null means the algorithm is stateless and has nothing to store. Writing
    // it back would erase whatever cursor another algorithm had left there.
    if (decision.updated_config !== null) {
      await adminClient
        .from("assignment_rules")
        .update({ config: decision.updated_config })
        .eq("market_id", order.market_id);
    }
  } catch (err) {
    // Best-effort: the order stays 'pending' for manual assignment. Logged
    // rather than silently swallowed — a malformed share row used to fail
    // invisibly here, and "why is nothing being assigned" had no trace at all.
    console.error("[tryAutoAssign] failed", {
      order_id: order.id,
      market_id: order.market_id,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
