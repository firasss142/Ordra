import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import {
  verifyAndDeleteDuplicateSibling,
  DuplicateSiblingError,
} from "@/lib/orders/duplicate-delete";

export const dynamic = "force-dynamic";

/**
 * Deletes a DUPLICATE SIBLING order from the duplicate dialog. `[id]` is the
 * anchor order (whose dialog was opened); the sibling to delete is in the body.
 * All authorization + the genuine-sibling re-verification lives in
 * verifyAndDeleteDuplicateSibling — this handler only parses + maps errors.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  let siblingId: string | undefined;
  try {
    const body = await req.json();
    siblingId = typeof body?.sibling_id === "string" ? body.sibling_id : undefined;
  } catch {
    // handled below
  }

  if (!siblingId) {
    return NextResponse.json({ error: "sibling_id is required" }, { status: 400 });
  }
  if (siblingId === id) {
    return NextResponse.json(
      { error: "Cannot duplicate-delete the anchor order itself" },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  try {
    const result = await verifyAndDeleteDuplicateSibling(
      supabase,
      createAdminClient(),
      { anchorId: id, targetId: siblingId, actor },
    );
    return NextResponse.json({ data: result });
  } catch (err) {
    if (err instanceof DuplicateSiblingError) {
      return NextResponse.json(
        { error: err.message, reason: err.reason },
        { status: err.status },
      );
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
