import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

interface SyncRun {
  id: string;
  source: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  trigger: string;
  error: string | null;
}

/**
 * GET /api/admin/sync-runs — the Journaux "Synchronisations" tab.
 *
 * Unions the four sync-run tables (Google Sheets, Meta Ads, Darb sync, Darb
 * rate harvest) into one time-ordered feed. Each table is queried
 * independently and tolerated on error, so one missing/renamed table doesn't
 * blank the whole tab — the pre-redesign catch-swallowing bug taught us not to
 * couple these. super_admin only, mirroring the other admin log routes.
 */
const SOURCES: { table: string; label: string; errorCol?: string }[] = [
  { table: "sheet_sync_runs", label: "Google Sheets", errorCol: "error" },
  { table: "ad_sync_runs", label: "Meta Ads", errorCol: "error" },
  { table: "darb_sync_runs", label: "Darb Assabil", errorCol: "error_message" },
  { table: "darb_rate_harvest_runs", label: "Darb — tarifs" },
];

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  if (actorResult.actor.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limit = Math.min(200, Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") ?? "60", 10)));

  const results = await Promise.all(
    SOURCES.map(async ({ table, label, errorCol }) => {
      try {
        const cols = ["id", "started_at", "finished_at", "status", "trigger"];
        if (errorCol) cols.push(errorCol);
        const { data, error } = await supabase
          .from(table)
          .select(cols.join(", "))
          .order("started_at", { ascending: false })
          .limit(limit);
        if (error || !data) return [] as SyncRun[];
        return (data as unknown as Record<string, unknown>[]).map((r) => ({
          id: String(r.id),
          source: label,
          started_at: String(r.started_at),
          finished_at: (r.finished_at as string | null) ?? null,
          status: String(r.status),
          trigger: String(r.trigger),
          error: errorCol ? ((r[errorCol] as string | null) ?? null) : null,
        }));
      } catch {
        return [] as SyncRun[];
      }
    }),
  );

  const merged = results
    .flat()
    .sort((a, b) => (a.started_at < b.started_at ? 1 : a.started_at > b.started_at ? -1 : 0))
    .slice(0, limit);

  return NextResponse.json({ data: merged });
}
