import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canManageAgents } from "@/lib/settings-permissions";
import { uploadAvatarDataUrl } from "@/lib/avatars";
import { returnToPool } from "@/lib/orders";
import { isValidDeactivationReason } from "@/lib/agent-deactivation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withRouteErrors } from "@/lib/journal/route-errors";

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

async function handlePATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const [actorResult, { data: target }] = await Promise.all([
    getActor(req),
    supabase.from("users").select("market_id, role").eq("id", id).single(),
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

  const { action, new_password, avatar, reason, warehouse_id } = body as {
    action?: string;
    new_password?: string;
    avatar?: string | null;
    reason?: string;
    warehouse_id?: string | null;
  };

  const admin = createAdminClient({ actorId: actor.id });

  // Status and deletion are written with the service client, like avatar and
  // building below: since 20260919230419_users_update_column_grant.sql a
  // logged-in session may only UPDATE users.last_seen_at, so these writes
  // through the session failed with 42501. Who may act on whom is decided
  // above, before any write.
  if (action === "reactivate") {
    const { error } = await admin
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

    const { error } = await admin
      .from("users")
      .update({ is_active: false, deactivation_reason: reason })
      .eq("id", id);

    if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

    // Flipping is_active alone leaves the Supabase session usable. Revoke it so
    // the account cannot keep acting until its profile cookie expires.
    try {
      await admin.auth.admin.signOut(id, "global");
    } catch (signOutError) {
      // Best effort — the account is already flagged inactive, and both
      // getActor() and getServerUser() reject it on the next cookie refresh.
      console.error("[PATCH /api/agents] session revoke failed:", signOutError);
    }

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

  /*
   * Which building this agent works out of.
   *
   * Libya prepares from two, one per Darb Assabil account, and they are not
   * interchangeable: a parcel booked on the Benghazi account handed to Darb
   * Tripoli does not exist in their system. `users.warehouse_id` has existed
   * since 20260922000010 and nothing ever wrote it, so the scan guard — which
   * needs a site on the agent AND the order — could never arm. This is that
   * write, and it is deliberately the only user field this route edits.
   */
  if (action === "set_warehouse") {
    if (target.role !== "warehouse_agent") {
      return NextResponse.json(
        { error: "Only a warehouse agent works out of a building" },
        { status: 400 },
      );
    }

    const siteId = typeof warehouse_id === "string" && warehouse_id.trim() !== ""
      ? warehouse_id.trim()
      : null;

    if (siteId) {
      const { data: site } = await supabase
        .from("warehouses")
        .select("id, market_id, is_active")
        .eq("id", siteId)
        .maybeSingle<{ id: string; market_id: string; is_active: boolean }>();

      if (!site || !site.is_active) {
        return NextResponse.json({ error: "Unknown or closed warehouse" }, { status: 400 });
      }
      /*
       * Same market, always. A Libyan agent pinned to Tunis would read as
       * "assigned" on every screen while the scan guard compared two sites that
       * can never match — an agent locked out of their own bench with nothing
       * on screen to explain why.
       */
      if (site.market_id !== targetMarketId) {
        return NextResponse.json(
          { error: "That warehouse belongs to another market" },
          { status: 400 },
        );
      }
    }

    const { error } = await admin
      .from("users")
      .update({ warehouse_id: siteId })
      .eq("id", id);

    if (error) {
      console.error("[PATCH /api/agents] set warehouse error:", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }

    await writeAuditLog(admin, actor.id, id, "warehouse_assigned", { warehouse_id: siteId });

    return NextResponse.json({ success: true, warehouse_id: siteId });
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
async function handleDELETE(
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

  const admin = createAdminClient({ actorId: actor.id });

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

  // Service client, for the same reason as the status writes in PATCH.
  const { error } = await admin
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

export const PATCH = withRouteErrors("/api/agents/[id]", "PATCH", handlePATCH);
export const DELETE = withRouteErrors("/api/agents/[id]", "DELETE", handleDELETE);
