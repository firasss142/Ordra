import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { lockedResponse } from "@/lib/orders/order-lock-response";
import {
  bulkDeleteDuplicateSiblings,
  type BulkDeletePair,
} from "@/lib/orders/duplicate-bulk-delete";

export const dynamic = "force-dynamic";

/**
 * One request per screenful of review, instead of one per duplicate.
 *
 * Every pair still goes through verifyAndDeleteDuplicateSibling, which
 * re-derives the sibling set server-side — a client cannot name an arbitrary
 * order as a "duplicate" and have it deleted. This handler only parses, gates
 * by role, and maps the result.
 */

/** Matches the review screen, which pages at 100 groups. */
const MAX_PAIRS = 100;

export async function POST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  // Agents get the screen read-only: they can see a duplicate before calling
  // the customer, but deleting is a manager's call. The UI hides the controls;
  // this is the part that actually enforces it.
  if (actor.role !== "super_admin" && actor.role !== "market_manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw = body.pairs;
  if (!Array.isArray(raw) || raw.length === 0) {
    return NextResponse.json(
      { error: "pairs is required and must be non-empty" },
      { status: 400 },
    );
  }
  if (raw.length > MAX_PAIRS) {
    return NextResponse.json(
      { error: `Cannot delete more than ${MAX_PAIRS} duplicates in one batch` },
      { status: 400 },
    );
  }

  const pairs: BulkDeletePair[] = [];
  for (const p of raw) {
    const anchorId = (p as { anchor_id?: unknown })?.anchor_id;
    const siblingId = (p as { sibling_id?: unknown })?.sibling_id;
    if (typeof anchorId !== "string" || !anchorId) {
      return NextResponse.json({ error: "Each pair needs an anchor_id" }, { status: 400 });
    }
    if (typeof siblingId !== "string" || !siblingId) {
      return NextResponse.json({ error: "Each pair needs a sibling_id" }, { status: 400 });
    }
    if (anchorId === siblingId) {
      return NextResponse.json(
        { error: "Cannot delete the anchor order itself" },
        { status: 400 },
      );
    }
    pairs.push({ anchor_id: anchorId, sibling_id: siblingId });
  }

  const supabase = await createClient();

  try {
    const result = await bulkDeleteDuplicateSiblings(supabase, createAdminClient(), {
      pairs,
      actor,
    });
    // 200 with both arrays: a batch where nineteen of twenty succeeded is not
    // an error, and the caller needs to know which one did not.
    return NextResponse.json({ data: result });
  } catch (err) {
    // The agent-presence guard (SQLSTATE 55006) is a refusal, not a fault.
    const locked = lockedResponse(err);
    if (locked) return locked;
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
