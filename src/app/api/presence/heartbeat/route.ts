import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = await createClient();

  // Signed-cookie fast path instead of auth.getUser(), the same switch
  // /api/notifications already made.
  //
  // This route fires every 60 s per open tab, and each beat was paying a GoTrue
  // round trip. Once middleware stopped calling /auth/v1/user on navigation
  // (Step 10), the edge logs showed this heartbeat as the dominant remaining
  // source of that traffic — a flat ~250 calls/hour that never moved with page
  // activity because it is a fixed-rate poller, not navigation.
  //
  // Identity only: the UPDATE below is still scoped by RLS to the acting user.
  const actorResult = await getActor();
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  const { error } = await supabase
    .from("users")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", actor.id);

  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  return NextResponse.json({ ok: true });
}
