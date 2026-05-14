import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { canManageAgents } from "@/lib/settings-permissions";
import { getActor } from "@/lib/auth/actor";
import { uploadAvatarDataUrl } from "@/lib/avatars";

export const dynamic = "force-dynamic";

const USER_COLS =
  "id, email, full_name, avatar_url, phone, role, market_id, is_active, last_seen_at, created_at";

export async function GET(req: NextRequest) {
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  const targetMarketId =
    actor.role === "market_manager"
      ? actor.market_id ?? ""
      : req.nextUrl.searchParams.get("market_id") ?? actor.market_id ?? "";

  if (!canManageAgents(role, targetMarketId, actor.market_id ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let query = supabase.from("users").select(USER_COLS).eq("role", "agent");

  if (actor.role === "market_manager") {
    query = query.eq("market_id", actor.market_id);
  } else if (targetMarketId) {
    query = query.eq("market_id", targetMarketId);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[GET /api/agents] query error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json(
    { data },
    { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=300" } },
  );
}

export async function POST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { username, password, market_id, avatar } = body as Record<
    string,
    string | undefined
  >;

  const targetMarketId =
    actor.role === "market_manager"
      ? actor.market_id ?? ""
      : market_id ?? actor.market_id ?? "";

  if (!canManageAgents(role, targetMarketId, actor.market_id ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!username || !password || !targetMarketId) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const email = `${username.trim().toLowerCase().replace(/\s+/g, ".")}@oms.local`;

  const admin = createAdminClient();

  const { data: authUser, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (authError || !authUser.user) {
    console.error("[POST /api/agents] auth.createUser error:", authError);
    const msg = authError?.message ?? "";
    if (msg.includes("already registered") || msg.includes("already been registered")) {
      return NextResponse.json({ error: "Ce nom d'utilisateur est déjà pris" }, { status: 409 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  let avatarUrl: string | null = null;
  if (avatar) {
    const upload = await uploadAvatarDataUrl(authUser.user.id, avatar);
    if (!upload.ok) {
      await admin.auth.admin.deleteUser(authUser.user.id);
      return NextResponse.json({ error: upload.error }, { status: upload.status });
    }
    avatarUrl = upload.url;
  }

  const { data, error: insertError } = await admin
    .from("users")
    .insert({
      id: authUser.user.id,
      email,
      full_name: username.trim(),
      avatar_url: avatarUrl,
      phone: null,
      role: "agent",
      market_id: targetMarketId,
      is_active: true,
      last_seen_at: new Date().toISOString(),
    })
    .select(USER_COLS)
    .single();

  if (insertError) {
    console.error("[POST /api/agents] users.insert error:", insertError);
    await admin.auth.admin.deleteUser(authUser.user.id);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data }, { status: 201 });
}
