import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: actor, error: actorError } = await supabase
    .from("users")
    .select("role, market_id")
    .eq("id", user.id)
    .single();

  if (actorError || !actor) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (actor.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const params = req.nextUrl.searchParams;
  const limit = Math.min(100, Math.max(1, parseInt(params.get("limit") ?? "50", 10) || 50));
  const offset = Math.max(0, parseInt(params.get("offset") ?? "0", 10) || 0);
  const targetId = params.get("target_id");

  const admin = createAdminClient();
  let query = admin
    .from("user_audit_log")
    .select("*, actor:users!actor_id(full_name, avatar_url), target:users!target_id(full_name)")
    .order("created_at", { ascending: false });

  if (targetId) {
    query = query.eq("target_id", targetId);
  }

  const { data, error } = await query.range(offset, offset + limit - 1);
  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data });
}
