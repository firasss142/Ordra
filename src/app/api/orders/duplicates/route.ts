import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import {
  getDuplicateWindowHours,
  getAutoselectWindowHours,
} from "@/lib/duplicate-orders/window";
import {
  deriveGroupConfidence,
  membersShareAddress,
  membersShareCity,
  groupSpanMinutes,
  type DuplicateGroup,
  type DuplicateGroupMember,
} from "@/lib/duplicate-orders/groups";

export const dynamic = "force-dynamic";

const DEFAULT_DAYS_BACK = 90;
const DEFAULT_LIMIT = 100;

interface RpcRow {
  group_key: string;
  member_count: number;
  members: DuplicateGroupMember[] | null;
}

/**
 * Groups of likely-duplicate orders for the review screen.
 *
 * Read-only. Deletion is a separate POST that runs each pair through the
 * existing per-sibling gate — nothing here decides what may be removed, it only
 * says what the confidence is and which members are even eligible.
 */
export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  const marketId = req.nextUrl.searchParams.get("market_id");
  if (!marketId) {
    return NextResponse.json({ error: "market_id is required" }, { status: 400 });
  }

  // The RPC carries its own market guard, but it answers an out-of-scope
  // request with an empty set — indistinguishable from "no duplicates". Fail
  // loudly here so a mis-scoped call is a bug report, not a silent blank page.
  if (actor.role !== "super_admin" && actor.market_id !== marketId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();

  const [windowHours, autoselectHours] = await Promise.all([
    getDuplicateWindowHours(supabase, marketId),
    getAutoselectWindowHours(supabase, marketId),
  ]);

  const { data, error } = await supabase.rpc("get_duplicate_groups", {
    p_market_id: marketId,
    p_window_hours: windowHours,
    p_days_back: DEFAULT_DAYS_BACK,
    p_limit: DEFAULT_LIMIT,
    p_offset: 0,
  });

  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const groups: DuplicateGroup[] = ((data ?? []) as RpcRow[])
    .map((row) => {
      const members = row.members ?? [];
      return {
        key: row.group_key,
        members,
        confidence: deriveGroupConfidence(members, autoselectHours),
        address_matches: membersShareAddress(members),
        city_matches: membersShareCity(members),
        span_minutes: groupSpanMinutes(members),
      };
    })
    .filter((g) => g.members.length > 1);

  return NextResponse.json({
    data: {
      groups,
      window_hours: windowHours,
      autoselect_window_hours: autoselectHours,
    },
  });
}
