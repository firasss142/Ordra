import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

/**
 * Put finished orders away, or bring them back.
 *
 * Archiving is visibility and nothing else: it sets `archived_at`, which drops
 * the order out of the default Commandes list. Every KPI, every metric and
 * every search still see it. Un-archiving simply clears the stamp.
 *
 * Deliberately NOT a status change — the order's status is what happened to it,
 * and tidying a list must never rewrite that.
 */
const bodySchema = z.object({
  order_ids: z.array(z.string().uuid()).min(1).max(500),
  action: z.enum(["archive", "unarchive"]),
});

type SkipReason = "not_finished" | "already_archived" | "not_archived";

export async function POST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (actor.role !== "super_admin" && actor.role !== "market_manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { order_ids, action } = parsed.data;
  const archiving = action === "archive";

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("orders")
    .select("id, market_id, terminal_at, archived_at")
    .in("id", Array.from(new Set(order_ids)));

  if (error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const rows = (data ?? []) as Array<{
    id: string;
    market_id: string;
    terminal_at: string | null;
    archived_at: string | null;
  }>;

  // Cross-market ids are a bug in the caller, not a per-order outcome — fail the
  // whole request rather than silently archiving the subset that is in scope.
  if (actor.role === "market_manager") {
    const foreign = rows.some((r) => r.market_id !== actor.market_id);
    if (foreign) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const skipped: Array<{ order_id: string; reason: SkipReason }> = [];
  const eligible: string[] = [];

  for (const row of rows) {
    if (archiving) {
      // The database CHECK refuses this too; catching it here turns a 500 into
      // a reason the operator can read.
      if (!row.terminal_at) {
        skipped.push({ order_id: row.id, reason: "not_finished" });
        continue;
      }
      if (row.archived_at) {
        skipped.push({ order_id: row.id, reason: "already_archived" });
        continue;
      }
    } else if (!row.archived_at) {
      skipped.push({ order_id: row.id, reason: "not_archived" });
      continue;
    }
    eligible.push(row.id);
  }

  if (eligible.length > 0) {
    const payload = archiving
      ? { archived_at: new Date().toISOString(), archived_by: actor.id }
      : { archived_at: null, archived_by: null };

    const { error: writeError } = await supabase
      .from("orders")
      .update(payload)
      .in("id", eligible);

    if (writeError) {
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  }

  return NextResponse.json({
    data: { archived: eligible.length, skipped },
  });
}
