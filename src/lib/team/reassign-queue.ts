/**
 * Client-side helper behind "Réassigner ▾" / "Retour au pool" on the roster.
 * Reuses the two existing endpoints — the agent's non-terminal queue and the
 * per-order reassign route (assign_order / return_order_to_pool RPCs) — so
 * ownership changes go through the same audited path as everywhere else.
 */

import { readActionFailure } from "@/lib/orders/action-failure";
export interface QueueRow {
  id: string;
  status: string;
}

const REASSIGNABLE = new Set([
  "pending",
  "attempt_1",
  "attempt_2",
  "attempt_3",
  "callback_scheduled",
  "confirmed",
]);

export async function fetchAgentQueueIds(agentId: string): Promise<string[]> {
  const res = await fetch(`/api/team/${agentId}/queue`, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`queue ${res.status}`);
  const json = (await res.json()) as { data?: QueueRow[] };
  return (json.data ?? []).filter((r) => REASSIGNABLE.has(r.status)).map((r) => r.id);
}

export interface ReassignOutcome {
  ok: number;
  failed: number;
  /** Skipped because an agent had the order open. Not a failure. */
  locked: number;
  /** Who is still holding one, for the toast. Deduplicated. */
  lockedBy: string[];
}

export async function reassignOrders(
  orderIds: string[],
  targetAgentId: string | null,
): Promise<ReassignOutcome> {
  let ok = 0;
  let failed = 0;
  let locked = 0;
  const lockedBy = new Set<string>();

  // Sequential on purpose: each call runs a SECURITY DEFINER RPC that appends
  // history; a 30-wide Promise.all against the same agent's rows is how the
  // old page produced "Statut déjà modifié" toasts.
  for (const id of orderIds) {
    const res = await fetch(`/api/orders/${id}/reassign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_agent_id: targetAgentId }),
    });
    if (res.ok) {
      ok += 1;
      continue;
    }
    // This surface moves an agent's ENTIRE queue at once, so it is the likeliest
    // place to yank the exact order somebody is on the phone about. Counting a
    // lock as a plain failure is what would make the toast unactionable.
    const body = await res.json().catch(() => null);
    const failure = readActionFailure(res.status, body);
    if (failure.locked) {
      locked += 1;
      if (failure.locked.holder_name) lockedBy.add(failure.locked.holder_name);
    } else {
      failed += 1;
    }
  }
  return { ok, failed, locked, lockedBy: Array.from(lockedBy) };
}

export async function reassignAgentQueue(agentId: string, targetAgentId: string | null): Promise<ReassignOutcome> {
  const ids = await fetchAgentQueueIds(agentId);
  if (ids.length === 0) return { ok: 0, failed: 0, locked: 0, lockedBy: [] };
  return reassignOrders(ids, targetAgentId);
}
