import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canManageAgents } from "@/lib/settings-permissions";
import { uploadAvatarDataUrl } from "@/lib/avatars";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const [actorResult, { data: target }] = await Promise.all([
    getActor(req),
    supabase.from("users").select("market_id").eq("id", id).single(),
  ]);

  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const targetMarketId = target.market_id ?? "";

  if (!canManageAgents(actor.role, targetMarketId, actor.market_id ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { action, new_password, avatar } = body as {
    action?: string;
    new_password?: string;
    avatar?: string | null;
  };

  if (action === "reactivate") {
    const { error } = await supabase
      .from("users")
      .update({ is_active: true })
      .eq("id", id);

    if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

    return NextResponse.json({ success: true });
  }

  if (action === "deactivate") {
    const { error } = await supabase
      .from("users")
      .update({ is_active: false })
      .eq("id", id);

    if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

    return NextResponse.json({ success: true, ordersReturned: 0 });
  }

  if (action === "update_avatar") {
    const admin = createAdminClient();
    let avatarUrl: string | null = null;

    if (avatar) {
      const upload = await uploadAvatarDataUrl(id, avatar);
      if (!upload.ok) {
        return NextResponse.json({ error: upload.error }, { status: upload.status });
      }
      avatarUrl = upload.url;
    }

    const { error } = await admin
      .from("users")
      .update({ avatar_url: avatarUrl })
      .eq("id", id);

    if (error) {
      console.error("[PATCH /api/agents] update avatar error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    return NextResponse.json({ success: true, avatar_url: avatarUrl });
  }

  if (action === "reset_password") {
    if (!new_password) {
      return NextResponse.json({ error: "new_password is required" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { error } = await admin.auth.admin.updateUserById(id, {
      password: new_password,
    });

    if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
