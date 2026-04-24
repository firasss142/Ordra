import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { decrypt } from "@/lib/crypto";
import { handleWebhook } from "@/lib/orders/webhook-handler";

/**
 * super_admin replay for a failed webhook delivery.
 *
 * Safety contract:
 *  - Only `status='error'` rows are replayable. Already-processed rows are rejected.
 *  - Signature validation is skipped (payload comes from our own audit log, trusted).
 *  - The (storefront_id, external_id) pre-check is skipped — but downstream writes
 *    are still guarded by the orders table unique constraint on
 *    (storefront_id, external_id). A replay of a payload whose order already
 *    exists returns `duplicate:true` and is logged as `ignored`.
 *  - Calling replay N times on the same failed log is safe: at most one order is
 *    created; subsequent calls either succeed-as-duplicate or fail identically.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (actor.role !== "super_admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  const { data: log, error: fetchError } = await supabase
    .from("webhook_delivery_log")
    .select("id, storefront_id, status, payload")
    .eq("id", id)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
  if (!log) {
    return NextResponse.json({ error: "Log entry not found" }, { status: 404 });
  }
  if (log.status !== "error") {
    return NextResponse.json(
      { error: "Only failed deliveries can be replayed", status: log.status },
      { status: 409 },
    );
  }
  if (!log.storefront_id) {
    return NextResponse.json(
      { error: "Log entry has no storefront_id — cannot replay" },
      { status: 422 },
    );
  }
  if (log.payload === null || log.payload === undefined) {
    return NextResponse.json(
      { error: "Log entry has no payload — cannot replay" },
      { status: 422 },
    );
  }

  // Reconstruct a minimal rawBody string from the stored JSON payload.
  const rawBody = JSON.stringify(log.payload);

  const adminClient = createAdminClient();
  const result = await handleWebhook({
    storefrontId: log.storefront_id,
    rawBody,
    headers: new Headers(),
    adminClient,
    decryptFn: decrypt,
    allowReplay: true,
  });

  return NextResponse.json(
    {
      replayed_log_id: id,
      result: result.body,
    },
    { status: result.status === 200 ? 200 : result.status },
  );
}
