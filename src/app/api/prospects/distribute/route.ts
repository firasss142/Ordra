import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canUseProspectConsole } from "@/lib/role-permissions";
import { UUID_RE } from "@/lib/investors/admin-route";
import {
  planDistribution,
  type DistributionAgent,
  type DistributionLead,
  type DistributionRule,
} from "@/lib/prospects/distribution";

export const dynamic = "force-dynamic";

/**
 * POST /api/prospects/distribute — hand the unowned prospects to agents.
 *
 * The console's primary act. Measured in production on 2026-09-15: 1 984 of
 * 1 992 prospects carry no agent, so no queue shows them and nobody calls
 * them. Everything else on the page reports; this changes something.
 *
 * `?preview=1` plans without writing. The preview and the write run the same
 * pure planDistribution() over the same input, so what the manager confirms is
 * what happens.
 *
 *   market_manager → own market; a market_id in the body is ignored
 *   super_admin    → must name the market
 *   agent          → refused
 *
 * Design: prototypes/prospects-manager-v1.html (the « Répartir » sheet).
 * Rules: plans/suivi-livraison.md decision 33.
 */

const RULES: DistributionRule[] = ["history_then_round_robin", "round_robin", "by_queue"];

/** How many prospects one plan may move. Above this the pool is worked in batches. */
const MAX_POOL = 2000;
const MAX_CAP = 500;

/** Statuses a prospect can be in and still be worth handing to someone. */
const ASSIGNABLE_STATUSES = ["new", "assigned", "attempt_1", "attempt_2", "attempt_3", "callback_scheduled", "qualified"];

interface Body {
  market_id?: string;
  agent_ids?: string[];
  rule?: string;
  cap?: number;
  /** A hand-picked selection. Absent means the whole unowned pool. */
  lead_ids?: string[];
}

export async function POST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (!canUseProspectConsole(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // A manager's own market always wins over whatever the body claims.
  const marketId = actor.role === "super_admin" ? body.market_id : actor.market_id;
  if (!marketId || !UUID_RE.test(marketId)) {
    return NextResponse.json({ error: "market_required" }, { status: 400 });
  }

  const agentIds = Array.isArray(body.agent_ids) ? body.agent_ids.filter((id) => UUID_RE.test(id)) : [];
  if (agentIds.length === 0) {
    return NextResponse.json({ error: "agents_required" }, { status: 400 });
  }

  const rule = (body.rule ?? "history_then_round_robin") as DistributionRule;
  if (!RULES.includes(rule)) {
    return NextResponse.json({ error: "invalid_rule" }, { status: 400 });
  }

  const cap = Number(body.cap);
  if (!Number.isFinite(cap) || cap < 1 || cap > MAX_CAP) {
    return NextResponse.json({ error: "invalid_cap" }, { status: 400 });
  }

  const preview = req.nextUrl.searchParams.get("preview") === "1";
  const supabase = await createClient();

  // The batch: either what the manager ticked, or everything nobody owns.
  let poolQuery = supabase
    .from("leads")
    .select("id, customer_phone, status")
    .eq("market_id", marketId)
    .in("status", ASSIGNABLE_STATUSES)
    .limit(MAX_POOL);

  if (Array.isArray(body.lead_ids) && body.lead_ids.length > 0) {
    poolQuery = poolQuery.in("id", body.lead_ids.slice(0, MAX_POOL));
  } else {
    poolQuery = poolQuery.is("assigned_to", null);
  }

  // The roster and the pool are independent reads; the database is ~130 ms
  // away and awaiting them in sequence would cost a whole round trip.
  const [poolResult, agentResult] = await Promise.all([
    poolQuery.order("created_at", { ascending: true }),
    supabase
      .from("users")
      .select("id, full_name, is_active")
      .eq("market_id", marketId)
      .eq("role", "agent")
      .in("id", agentIds),
  ]);

  if (poolResult.error || agentResult.error) {
    console.error("[api/prospects/distribute] read failed", poolResult.error ?? agentResult.error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const pool = (poolResult.data ?? []) as { id: string; customer_phone: string | null }[];
  const roster = (agentResult.data ?? []).filter((a) => a.is_active) as {
    id: string; full_name: string | null;
  }[];

  if (roster.length === 0) {
    return NextResponse.json({ error: "agents_required" }, { status: 400 });
  }

  // Nothing to do is an answer, not a failure: a manager who distributes twice
  // must be told the pool is empty rather than shown an error.
  if (pool.length === 0) {
    return NextResponse.json({ rows: [], assigned: 0, left: 0, byHistory: 0, byRoundRobin: 0 });
  }

  const [load, history] = await Promise.all([
    agentLoad(supabase, marketId, roster.map((a) => a.id)),
    // Only decision 33's rule needs to know who called these customers before.
    rule === "history_then_round_robin"
      ? priorAgents(supabase, marketId, pool.map((l) => l.customer_phone))
      : Promise.resolve(new Map<string, string>()),
  ]);

  const agents: DistributionAgent[] = roster.map((a) => ({
    id: a.id,
    name: a.full_name ?? "—",
    queue: load.get(a.id)?.queue ?? 0,
    callsToday: load.get(a.id)?.callsToday ?? 0,
  }));

  const leads: DistributionLead[] = pool.map((l) => ({
    id: l.id,
    lastAgentId: l.customer_phone ? history.get(l.customer_phone) ?? null : null,
  }));

  const plan = planDistribution({ leads, agents, rule, cap });

  const summary = {
    rows: plan.rows,
    assigned: plan.assigned,
    left: plan.left,
    byHistory: plan.rows.reduce((s, r) => s + r.byHistory, 0),
    byRoundRobin: plan.rows.reduce((s, r) => s + r.byRoundRobin, 0),
  };

  if (preview) return NextResponse.json(summary);

  const { data, error } = await supabase.rpc("bulk_assign_leads", {
    p_market_id: marketId,
    p_assignments: plan.assignments.map((a) => ({ lead_id: a.leadId, agent_id: a.agentId })),
    p_actor_id: actor.id,
    p_actor_type: actor.role === "super_admin" ? "super_admin" : "manager",
  });

  if (error) {
    console.error("[api/prospects/distribute] bulk_assign_leads failed", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const result = (data ?? {}) as { assigned?: number; skipped?: number };
  return NextResponse.json({
    ...summary,
    // What the database actually did wins over what was planned: a prospect an
    // agent grabbed in between is skipped, and the manager should see that.
    assigned: result.assigned ?? summary.assigned,
    skipped: result.skipped ?? 0,
  });
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Each agent's open queue and calls made today, for the cap and the preview. */
async function agentLoad(
  supabase: Supabase,
  marketId: string,
  agentIds: string[],
): Promise<Map<string, { queue: number; callsToday: number }>> {
  const since = new Date();
  since.setHours(0, 0, 0, 0);

  const [queues, calls] = await Promise.all([
    supabase
      .from("leads")
      .select("assigned_to")
      .eq("market_id", marketId)
      .in("assigned_to", agentIds)
      .in("status", ASSIGNABLE_STATUSES),
    supabase
      .from("lead_history")
      .select("actor_id")
      .in("actor_id", agentIds)
      .gte("created_at", since.toISOString()),
  ]);

  const load = new Map<string, { queue: number; callsToday: number }>();
  for (const id of agentIds) load.set(id, { queue: 0, callsToday: 0 });

  for (const row of (queues.data ?? []) as { assigned_to: string | null }[]) {
    const entry = row.assigned_to ? load.get(row.assigned_to) : null;
    if (entry) entry.queue += 1;
  }
  for (const row of (calls.data ?? []) as { actor_id: string | null }[]) {
    const entry = row.actor_id ? load.get(row.actor_id) : null;
    if (entry) entry.callsToday += 1;
  }
  return load;
}

/**
 * The agent who last handled an order for each phone number — decision 33's
 * "the customer hears a voice they know".
 *
 * Measured: in Libya 288 of 288 unowned prospects have one, all still active.
 * In Tunisia only 93 of 1 685, because that stock came from a campaign built
 * over old orders. The preview reports the split so a manager in Tunis is not
 * promised a continuity they will not get.
 */
async function priorAgents(
  supabase: Supabase,
  marketId: string,
  phones: (string | null)[],
): Promise<Map<string, string>> {
  const wanted = [...new Set(phones.filter((p): p is string => Boolean(p)))];
  if (wanted.length === 0) return new Map();

  const { data, error } = await supabase
    .from("orders")
    .select("customer_phone, assigned_to, created_at")
    .eq("market_id", marketId)
    .in("customer_phone", wanted)
    .not("assigned_to", "is", null)
    .order("created_at", { ascending: true });

  if (error) {
    // The rule degrades to round robin rather than failing the distribution:
    // a batch that lands somewhere beats a batch that lands nowhere.
    console.error("[api/prospects/distribute] prior agents lookup failed", error);
    return new Map();
  }

  // Ascending order means the last write per phone is the most recent order.
  const byPhone = new Map<string, string>();
  for (const row of (data ?? []) as { customer_phone: string | null; assigned_to: string | null }[]) {
    if (row.customer_phone && row.assigned_to) byPhone.set(row.customer_phone, row.assigned_to);
  }
  return byPhone;
}
