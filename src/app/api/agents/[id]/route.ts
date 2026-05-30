import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canManageAgents } from "@/lib/settings-permissions";
import { uploadAvatarDataUrl } from "@/lib/avatars";
import { returnToPool } from "@/lib/orders";
import { isValidDeactivationReason } from "@/lib/agent-deactivation";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const REASSIGN_STATUSES = [
  "pending",
  "assigned",
  "attempt_1",
  "attempt_2",
  "attempt_3",
  "callback_scheduled",
];

async function writeAuditLog(
  admin: SupabaseClient,
  actorId: string,
  targetId: string,
  eventType: string,
  meta?: Record<string, unknown>
) {
  await admin.from("user_audit_log").insert({
    actor_id: actorId,
    target_id: targetId,
    event_type: eventType,
    meta: meta ?? null,
  });
}

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

  const { action, new_password, avatar, reason } = body as {
    action?: string;
    new_password?: string;
    avatar?: string | null;
    reason?: string;
  };

  const admin = createAdminClient();

  if (action === "reactivate") {
    const { error } = await supabase
      .from("users")
      .update({ is_active: true, deactivation_reason: null })
      .eq("id", id);

    if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

    await writeAuditLog(admin, actor.id, id, "user_reactivated");

    return NextResponse.json({ success: true });
  }

  if (action === "deactivate") {
    if (!reason) {
      return NextResponse.json({ error: "reason is required" }, { status: 400 });
    }
    if (!isValidDeactivationReason(reason)) {
      return NextResponse.json({ error: "Invalid reason" }, { status: 400 });
    }

    const { data: openOrders } = await supabase
      .from("orders")
      .select("id")
      .eq("assigned_to", id)
      .in("status", REASSIGN_STATUSES);

    let returned = 0;
    for (const order of openOrders ?? []) {
      await returnToPool(supabase, order.id, actor.id);
      returned++;
    }

    const { error } = await supabase
      .from("users")
      .update({ is_active: false, deactivation_reason: reason })
      .eq("id", id);

    if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

    await writeAuditLog(admin, actor.id, id, "user_deactivated", {
      reason,
      orders_returned: returned,
    });

    return NextResponse.json({ success: true, ordersReturned: returned });
  }

  if (action === "update_avatar") {
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

    await writeAuditLog(admin, actor.id, id, "avatar_updated");

    return NextResponse.json({ success: true, avatar_url: avatarUrl });
  }

  if (action === "reset_password") {
    if (!new_password) {
      return NextResponse.json({ error: "new_password is required" }, { status: 400 });
    }

    const { error } = await admin.auth.admin.updateUserById(id, {
      password: new_password,
    });

    if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

    await writeAuditLog(admin, actor.id, id, "password_reset");

    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

// Soft-delete: removes the auth user (blocks login) and stamps users.deleted_at
// so historical FKs (order_history, audit log, …) stay intact.
// super_admin only.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const [actorResult, { data: target }] = await Promise.all([
    getActor(req),
    supabase.from("users").select("market_id, deleted_at").eq("id", id).single(),
  ]);

  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (actor.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (target.deleted_at) {
    return NextResponse.json({ error: "Already deleted" }, { status: 409 });
  }

  const admin = createAdminClient();

  const { data: openOrders } = await supabase
    .from("orders")
    .select("id")
    .eq("assigned_to", id)
    .in("status", REASSIGN_STATUSES);

  let returned = 0;
  for (const order of openOrders ?? []) {
    await returnToPool(supabase, order.id, actor.id);
    returned++;
  }

  // We CANNOT call auth.admin.deleteUser here: public.users has
  // FK(id) → auth.users(id) ON DELETE CASCADE, which would cascade-delete
  // the users row and then fail against the many NOT NULL FK references
  // pointing at public.users (warehouse_print_log.printed_by,
  // products.created_by, user_audit_log, …). Instead we ban the auth
  // account so it cannot log in; the public row stays intact for
  // historical joins.
  const { error: authError } = await admin.auth.admin.updateUserById(id, {
    ban_duration: "876000h",
  });
  if (authError) {
    console.error("[DELETE /api/agents] auth.admin.updateUserById ban failed:", authError);
    return NextResponse.json(
      { error: `Auth ban failed: ${authError.message}` },
      { status: 500 }
    );
  }

  const { error } = await supabase
    .from("users")
    .update({ is_active: false, deleted_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    console.error("[DELETE /api/agents] users update failed:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  await writeAuditLog(admin, actor.id, id, "user_deleted", {
    orders_returned: returned,
  });

  return NextResponse.json({ success: true, ordersReturned: returned });
}
