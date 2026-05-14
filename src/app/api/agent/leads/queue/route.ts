import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sortAgentLeadQueue } from "@/lib/leads/queue-sort";
import { TERMINAL_LEAD_STATUSES } from "@/types/lead";
import { getActor } from "@/lib/auth/actor";
import { enrichRowsWithCustomerHistory } from "@/lib/customer-history/enrich";

export const dynamic = "force-dynamic";

const ACTIVE_QUEUE_STATUSES = [
  "assigned",
  "attempt_1",
  "attempt_2",
  "attempt_3",
  "callback_scheduled",
  "qualified",
];

const CLOSED_WINDOW_DAYS = 7;

export async function GET(_req: NextRequest) {
  const supabase = await createClient();

    const actorResult = await getActor(_req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  if (role !== "agent") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();
  const closedSince = new Date(
    now.getTime() - CLOSED_WINDOW_DAYS * 24 * 60 * 60 * 1000
  );

  const [activeRes, closedRes] = await Promise.all([
    supabase
      .from("leads")
      .select("*")
      .eq("assigned_to", actor.id)
      .in("status", ACTIVE_QUEUE_STATUSES),
    supabase
      .from("leads")
      .select("*")
      .eq("assigned_to", actor.id)
      .in("status", TERMINAL_LEAD_STATUSES)
      .gte("updated_at", closedSince.toISOString())
      .order("updated_at", { ascending: false }),
  ]);

  if (activeRes.error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const allLeads = activeRes.data ?? [];
  const closedLeads = closedRes.data ?? [];

  // Hide future callbacks + qualified from primary bucket (still in allLeads for counts)
  const activeLeads = allLeads.filter((l) => {
    if (l.status === "callback_scheduled") {
      return (
        l.callback_scheduled_at &&
        new Date(l.callback_scheduled_at) <= now
      );
    }
    return true;
  });

  const sorted = sortAgentLeadQueue(activeLeads);

  const buckets = {
    nouveau: 0,
    tentative_1: 0,
    tentative_2: 0,
    tentative_3: 0,
    rappel_prevu: 0,
    qualifie: 0,
    gagne: 0,
    perdu: 0,
    fermees: closedLeads.length,
  };

  for (const l of allLeads) {
    const s = l.status as string;
    if (s === "assigned") buckets.nouveau++;
    else if (s === "attempt_1") buckets.tentative_1++;
    else if (s === "attempt_2") buckets.tentative_2++;
    else if (s === "attempt_3") buckets.tentative_3++;
    else if (s === "callback_scheduled") {
      const cb = l.callback_scheduled_at as string | null;
      if (!cb || new Date(cb) > now) buckets.rappel_prevu++;
    } else if (s === "qualified") buckets.qualifie++;
  }

  for (const l of closedLeads) {
    if (l.status === "won") buckets.gagne++;
    else if (l.status === "lost") buckets.perdu++;
  }

  const sortedIds = new Set(sorted.map((l) => l.id));
  const allSorted = [
    ...sorted,
    ...allLeads.filter((l) => !sortedIds.has(l.id)),
  ];

  const enrichedAll = await enrichRowsWithCustomerHistory(
    supabase,
    actor.market_id ?? null,
    "lead",
    allSorted,
  );
  const enrichedClosed = await enrichRowsWithCustomerHistory(
    supabase,
    actor.market_id ?? null,
    "lead",
    closedLeads,
  );
  const enrichedSortedSet = new Set(sorted.map((l) => l.id));
  const enrichedSorted = enrichedAll.filter((l) => enrichedSortedSet.has(l.id));

  return NextResponse.json({
    leads: enrichedSorted,
    allLeads: enrichedAll,
    closedLeads: enrichedClosed,
    buckets,
  });
}
