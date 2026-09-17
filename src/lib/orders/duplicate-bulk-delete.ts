import type { SupabaseClient } from "@supabase/supabase-js";
import type { Actor } from "@/lib/auth/actor";
import {
  verifyAndDeleteDuplicateSibling,
  DuplicateSiblingError,
  type VerifyAndDeleteResult,
} from "./duplicate-delete";

/**
 * Deleting a whole review screen's worth of duplicates in one request.
 *
 * This deliberately adds NO authorization of its own. It loops
 * verifyAndDeleteDuplicateSibling, whose 8-step gate re-derives the sibling set
 * server-side under the actor's RLS-scoped client and refuses anything that is
 * not genuinely a duplicate of its anchor. Reimplementing that check here would
 * mean two copies of the security model, and the copy that drifts is the one
 * that ships the bug — a client could then post any order id as a "sibling".
 */

export interface BulkDeletePair {
  /** The order being kept — the newest member of the group. */
  anchor_id: string;
  /** The duplicate to soft-delete. Must be a real sibling of the anchor. */
  sibling_id: string;
}

export interface BulkDeleteSuccess {
  order_id: string;
}

export interface BulkDeleteFailure {
  order_id: string;
  reason: string;
  error: string;
}

export interface BulkDeleteResult {
  succeeded: BulkDeleteSuccess[];
  failed: BulkDeleteFailure[];
}

type VerifyFn = typeof verifyAndDeleteDuplicateSibling;

export interface BulkDeleteParams {
  pairs: BulkDeletePair[];
  actor: Actor;
  /** Injectable for tests; defaults to the real verified single delete. */
  verify?: VerifyFn;
}

export async function bulkDeleteDuplicateSiblings(
  supabase: SupabaseClient,
  admin: SupabaseClient,
  params: BulkDeleteParams,
): Promise<BulkDeleteResult> {
  const verify = params.verify ?? verifyAndDeleteDuplicateSibling;

  const succeeded: BulkDeleteSuccess[] = [];
  const failed: BulkDeleteFailure[] = [];

  // A sibling repeated in one request would otherwise be deleted, then fail the
  // second time with a confusing "not a sibling" — it is already gone.
  const seen = new Set<string>();

  for (const p of params.pairs) {
    if (seen.has(p.sibling_id)) continue;
    seen.add(p.sibling_id);

    try {
      const result: VerifyAndDeleteResult = await verify(supabase, admin, {
        anchorId: p.anchor_id,
        targetId: p.sibling_id,
        actor: params.actor,
      });
      succeeded.push({ order_id: result.deleted_id });
    } catch (err) {
      // A typed refusal carries a reason the UI can translate. Anything else is
      // reported as internal_error: the message may hold internals, and a bulk
      // response is rendered straight into the summary modal.
      if (err instanceof DuplicateSiblingError) {
        failed.push({ order_id: p.sibling_id, reason: err.reason, error: err.message });
      } else {
        failed.push({
          order_id: p.sibling_id,
          reason: "internal_error",
          error: "Internal server error",
        });
      }
    }
  }

  return { succeeded, failed };
}
