import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * One row of a market's rejection taxonomy.
 *
 * DELETE is the interesting one. A reason that 213 orders already carry cannot
 * simply disappear — those orders would render a key nobody can resolve, and
 * `order_history` is append-only precisely so that recorded facts stay
 * recorded. So delete means two different things depending on the truth:
 *
 *   never used  → the row is removed outright. Nothing is lost.
 *   used        → the row is retired (`is_active = false`). It leaves the
 *                 agent's picker and keeps rendering on every past order.
 *
 * The response says which happened and how many orders were involved, so the
 * UI can tell the manager the truth rather than guessing.
 */

type Row = {
  id: string;
  market_id: string;
  parent_key: string | null;
  key: string;
  is_active: boolean;
};

async function loadRow(
  req: NextRequest,
  id: string,
  writable: boolean,
): Promise<
  | { error: NextResponse }
  | {
      row: Row;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: any;
    }
> {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return { error: actorResult.response };
  const { actor } = actorResult;

  const allowed = writable
    ? actor.role === "super_admin" || actor.role === "market_manager"
    : actor.role !== undefined;

  if (!allowed) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("rejection_reason_configs")
    .select("id, market_id, parent_key, key, is_active")
    .eq("id", id)
    .single();

  if (!data) {
    return {
      error: NextResponse.json(
        { error: "Rejection reason not found" },
        { status: 404 },
      ),
    };
  }

  if (actor.role !== "super_admin" && data.market_id !== actor.market_id) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { row: data as Row, supabase };
}

/** How many orders in this market were rejected for this reason. */
async function countUsage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  row: Row,
): Promise<number> {
  const { count } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("market_id", row.market_id)
    .eq("rejection_subreason", row.key)
    .limit(1);
  return count ?? 0;
}

async function handleGET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const loaded = await loadRow(req, id, false);
  if ("error" in loaded) return loaded.error;

  const usage = await countUsage(loaded.supabase, loaded.row);
  return NextResponse.json({ data: loaded.row, usage });
}

const MUTABLE = new Set([
  "label_fr",
  "label_ar",
  "short_fr",
  "short_ar",
  // No `hue`. Every rejection wears the rejected red and its group is told
  // apart by icon (lib/orders/rejection-config → REJECTION_GROUP_ICONS); the
  // column survives in the table, unread.
  "sort_order",
  "is_active",
]);

async function handlePATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Checked before the row is loaded: the answer does not depend on it, and a
  // caller trying to rename a key should hear why, not "not found".
  if (body.key !== undefined) {
    return NextResponse.json(
      {
        error:
          "key is immutable — it is written into orders.rejection_subreason, and renaming it would orphan every order that carries it",
      },
      { status: 400 },
    );
  }
  if (body.parent_key !== undefined) {
    return NextResponse.json(
      {
        error:
          "parent_key is immutable — moving a sub-reason between groups would re-icon and re-bucket every order already rejected for it",
      },
      { status: 400 },
    );
  }

  const loaded = await loadRow(req, id, true);
  if ("error" in loaded) return loaded.error;
  const { row, supabase } = loaded;

  const updates: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (MUTABLE.has(k) && v !== undefined) updates[k] = v;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "No mutable fields provided" },
      { status: 400 },
    );
  }

  if (
    updates.sort_order !== undefined &&
    typeof updates.sort_order !== "number"
  ) {
    return NextResponse.json(
      { error: "sort_order must be a number" },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("rejection_reason_configs")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ data });
}

async function handleDELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const loaded = await loadRow(req, id, true);
  if ("error" in loaded) return loaded.error;
  const { row, supabase } = loaded;

  if (row.parent_key === null) {
    return NextResponse.json(
      {
        error:
          "Cannot delete a rejection group: groups mirror the rejection_reason Postgres enum, which cannot drop a value. Retire its sub-reasons instead.",
      },
      { status: 409 },
    );
  }

  const usage = await countUsage(supabase, row);

  // Used by real orders → retire, never remove. This is the line that keeps
  // history readable.
  if (usage > 0) {
    const { error } = await supabase
      .from("rejection_reason_configs")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ mode: "retired", usage, data: { id } });
  }

  const { error } = await supabase
    .from("rejection_reason_configs")
    .delete()
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ mode: "deleted", usage: 0, data: { id } });
}

export const GET = withRouteErrors("/api/settings/rejection-reasons/[id]", "GET", handleGET);
export const PATCH = withRouteErrors("/api/settings/rejection-reasons/[id]", "PATCH", handlePATCH);
export const DELETE = withRouteErrors("/api/settings/rejection-reasons/[id]", "DELETE", handleDELETE);
