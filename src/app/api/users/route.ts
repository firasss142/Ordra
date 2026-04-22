import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { uploadAvatarDataUrl } from "@/lib/avatars";
import type { Role } from "@/types";

const USER_COLS =
  "id, email, full_name, avatar_url, phone, role, market_id, is_active, last_seen_at, created_at";

const CREATABLE_ROLES: readonly Role[] = [
  "market_manager",
  "agent",
  "warehouse_agent",
] as const;

function isCreatableRole(value: unknown): value is (typeof CREATABLE_ROLES)[number] {
  return typeof value === "string" && CREATABLE_ROLES.includes(value as Role);
}

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (actor.role !== "super_admin" && actor.role !== "market_manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  let query = admin
    .from("users")
    .select(USER_COLS)
    .order("created_at", { ascending: false });

  if (actor.role === "market_manager") {
    query = query
      .eq("market_id", actor.market_id ?? "")
      .in("role", ["agent", "warehouse_agent"]);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[GET /api/users] query error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data });
}

export async function POST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (actor.role !== "super_admin" && actor.role !== "market_manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const username = typeof body.username === "string" ? body.username : "";
  const password = typeof body.password === "string" ? body.password : "";
  const role = body.role;
  const requestedMarketId =
    typeof body.market_id === "string" ? body.market_id : null;
  const avatar = typeof body.avatar === "string" ? body.avatar : undefined;

  if (!username || !password) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (!isCreatableRole(role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  if (
    actor.role === "market_manager" &&
    role !== "agent" &&
    role !== "warehouse_agent"
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const marketId =
    actor.role === "market_manager" ? actor.market_id ?? null : requestedMarketId;

  if (!marketId) {
    return NextResponse.json(
      { error: "Un marché est requis" },
      { status: 400 }
    );
  }

  const email = `${username.trim().toLowerCase().replace(/\s+/g, ".")}@oms.local`;
  const admin = createAdminClient();

  const { data: authUser, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (authError || !authUser.user) {
    console.error("[POST /api/users] auth.createUser error:", authError);
    const msg = authError?.message ?? "";
    if (msg.includes("already registered") || msg.includes("already been registered")) {
      return NextResponse.json(
        { error: "Ce nom d'utilisateur est déjà pris" },
        { status: 409 }
      );
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
      role,
      market_id: marketId,
      is_active: true,
      last_seen_at: new Date().toISOString(),
    })
    .select(USER_COLS)
    .single();

  if (insertError) {
    console.error("[POST /api/users] users.insert error:", insertError);
    await admin.auth.admin.deleteUser(authUser.user.id);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data }, { status: 201 });
}
