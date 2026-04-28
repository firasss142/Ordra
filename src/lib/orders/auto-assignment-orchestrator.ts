import type { SupabaseClient } from "@supabase/supabase-js";
import type { AssignmentAlgorithm } from "@/types/settings";
import type { AssignableOrder } from "./auto-assignment-types";
import { selectAgent } from "./auto-assignment";
import { fetchAgentCapacity } from "./agent-capacity";

export async function tryAutoAssign(
  adminClient: SupabaseClient,
  order: AssignableOrder
): Promise<void> {
  try {
    // 1–3. Fetch algorithm setting, assignment rule, and active_agents_only in parallel
    const [{ data: settingsRow }, { data: rule }, { data: activeOnlyRow }] = await Promise.all([
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
      adminClient
        .from("settings")
        .select("value")
        .eq("market_id", order.market_id)
        .eq("key", "active_agents_only")
        .maybeSingle(),
    ]);

    const algorithmValue = settingsRow?.value as { type?: string; value?: string } | undefined;
    const algorithm = (algorithmValue?.type ?? algorithmValue?.value) as AssignmentAlgorithm | undefined;
    if (!algorithm || algorithm === "manual") return;

    if (!rule || !rule.is_active) return;

    const activeAgentsOnly =
      (activeOnlyRow?.value as { value?: boolean } | undefined)?.value === true;

    // 4. Fetch active agents
    let agents = await fetchAgentCapacity(adminClient, order.market_id);

    if (activeAgentsOnly) {
      // Filter to agents who have acted today; fall back to all active agents if none found
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const { data: actedRows } = await adminClient
        .from("order_history")
        .select("actor_id")
        .in("actor_id", agents.map((a) => a.id))
        .in("status_to", ["confirmed", "dispatched", "rejected"])
        .gte("created_at", todayStart.toISOString());

      const actedTodayIds = new Set((actedRows ?? []).map((r: { actor_id: string }) => r.actor_id));
      const activeToday = agents.filter((a) => actedTodayIds.has(a.id));
      if (activeToday.length > 0) {
        agents = activeToday;
      }
      // else: fall back to all active agents (prevent order stacking)
    }

    if (agents.length === 0) return;

    // 5. Select agent via pure engine
    const decision = selectAgent(order, agents, algorithm, rule.config);
    if (!decision) return;

    // 6. Assign via RPC with algorithm-specific note
    const algorithmNotes: Record<string, string> = {
      round_robin: "Auto-assigned via Tour de rôle",
      workload: "Auto-assigned via Charge de travail",
      product_based: "Auto-assigned via Règle produit",
      region_based: "Auto-assigned via Règle région",
    };
    const assignNote = algorithmNotes[algorithm] ?? "Auto-assigned";

    await adminClient.rpc("assign_order", {
      p_order_id: order.id,
      p_agent_id: decision.agent_id,
      p_actor_id: null,
      p_actor_type: "system",
      p_note: assignNote,
    });

    // 7. Persist updated config if needed
    if (decision.updated_config) {
      await adminClient
        .from("assignment_rules")
        .update({ config: decision.updated_config })
        .eq("market_id", order.market_id);
    }
  } catch {
    // Best-effort: order stays 'pending' for manual assignment
  }
}
