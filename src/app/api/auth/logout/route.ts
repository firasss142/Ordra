import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    // Stand down before signing out. Nulling last_seen_at alone would make the
    // agent stale — and therefore un-ready for routing — but leave
    // is_available true and release nothing, so the orders they never started
    // would sit in a queue nobody is watching until the midnight reset.
    //
    // Best-effort: a failure here must never block signing out. The RPC is
    // idempotent, so an agent who was already unavailable costs one no-op.
    const { error: availabilityErr } = await supabase.rpc("set_agent_availability", {
      p_agent_id: user.id,
      p_available: false,
      p_actor_id: user.id,
      p_reason: "logout",
    });
    if (availabilityErr) {
      // NOT_AN_AGENT is expected for every manager and super_admin.
      console.warn("[POST /api/auth/logout] availability stand-down skipped", {
        code: availabilityErr.code,
        details: availabilityErr.details,
      });
    }

    await supabase
      .from("users")
      .update({ last_seen_at: null })
      .eq("id", user.id);
  }

  const { error } = await supabase.auth.signOut();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const res = NextResponse.json({ success: true });
  res.cookies.set("oms_profile", "", { maxAge: 0, path: "/" });
  return res;
}
