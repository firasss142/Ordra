import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

/**
 * Break a live agent lock. super_admin only.
 *
 * Its own file rather than a fourth action on ../route.ts: different
 * authorisation, and it must be impossible to reach by fat-fingering an action
 * string on the endpoint every open panel calls twice a minute.
 *
 * The role check here is a courtesy 403. The real one is inside
 * force_release_order_presence, which raises 42501 for anyone but a
 * super_admin — a market_manager must not be able to break a lock by any path.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (actor.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("force_release_order_presence", {
    p_order_id: id,
  });

  if (error) {
    if (error.code === "42501") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // No live agent lock — it expired or the agent closed the panel while the
    // dialog was open. Nothing to do, and saying so beats a 500.
    if (error.code === "P0002") {
      return NextResponse.json({ error: "No live lock on this order" }, { status: 404 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data });
}
