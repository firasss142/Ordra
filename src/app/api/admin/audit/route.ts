import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

interface AuditRow {
  id: string;
  kind: "settings" | "user";
  at: string;
  actor: string | null;
  summary: string;
  meta: Record<string, unknown>;
}

/**
 * GET /api/admin/audit — the Journaux "Audit" tab (business audit trail).
 *
 * Unions settings_history (config changes, with before→after) and
 * user_audit_log (who deactivated/reset whom). Both already existed but had no
 * shared surface — the redesign brings them together. Connection events
 * (create/archive/rotate) will join here once a system_audit_log exists.
 * super_admin only. Each source is tolerated on error.
 */
function unwrap(v: unknown): unknown {
  if (v !== null && typeof v === "object" && !Array.isArray(v) && "value" in v) {
    return (v as { value: unknown }).value;
  }
  return v;
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  if (actorResult.actor.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limit = Math.min(200, Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") ?? "60", 10)));

  const [settingsRows, userRows] = await Promise.all([
    (async (): Promise<AuditRow[]> => {
      try {
        const { data, error } = await supabase
          .from("settings_history")
          .select("id, key, old_value, new_value, changed_at, changed_by, users:users!settings_history_changed_by_fkey(full_name)")
          .order("changed_at", { ascending: false })
          .limit(limit);
        if (error || !data) return [];
        return (data as Record<string, unknown>[]).map((r) => {
          const oldV = unwrap(r.old_value);
          const newV = unwrap(r.new_value);
          return {
            id: String(r.id),
            kind: "settings" as const,
            at: String(r.changed_at),
            actor: ((r.users as { full_name?: string } | null)?.full_name) ?? null,
            summary: `Réglage ${r.key} : ${JSON.stringify(oldV)} → ${JSON.stringify(newV)}`,
            meta: { key: r.key, old: oldV, new: newV },
          };
        });
      } catch {
        return [];
      }
    })(),
    (async (): Promise<AuditRow[]> => {
      try {
        const { data, error } = await supabase
          .from("user_audit_log")
          .select("id, event_type, meta, created_at, actor_id, target_id, actor:users!user_audit_log_actor_id_fkey(full_name), target:users!user_audit_log_target_id_fkey(full_name)")
          .order("created_at", { ascending: false })
          .limit(limit);
        if (error || !data) return [];
        return (data as Record<string, unknown>[]).map((r) => ({
          id: String(r.id),
          kind: "user" as const,
          at: String(r.created_at),
          actor: ((r.actor as { full_name?: string } | null)?.full_name) ?? null,
          summary: `${r.event_type} · ${((r.target as { full_name?: string } | null)?.full_name) ?? "utilisateur"}`,
          meta: (r.meta as Record<string, unknown>) ?? {},
        }));
      } catch {
        return [];
      }
    })(),
  ]);

  const merged = [...settingsRows, ...userRows]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit);

  return NextResponse.json({ data: merged });
}
