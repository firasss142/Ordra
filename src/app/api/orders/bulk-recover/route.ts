import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canRecoverDeletedOrder } from "@/lib/order-permissions";
import { withRouteErrors } from "@/lib/journal/route-errors";
import { readOrderLockError } from "@/lib/orders/order-lock";

export const dynamic = "force-dynamic";

/**
 * Archivées › Supprimées — « Restaurer » on a selection.
 *
 * One recover_deleted_order call per order, the same RPC as the single
 * restore (/api/orders/[id]/recover): the order goes back to Commandes at the
 * call stage it was deleted from. A refusal on one order never stops the rest;
 * the answer says which came back and why the others did not.
 */
const bodySchema = z.object({ order_ids: z.array(z.string().uuid()).min(1).max(200) });

type Failure = { order_id: string; reason: "not_found" | "not_deleted" | "forbidden" | "not_recoverable" | "locked" | "failed" };

async function handlePOST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (actor.role !== "super_admin" && actor.role !== "market_manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const ids = Array.from(new Set(parsed.data.order_ids));

  const supabase = await createClient();
  const { data, error } = await supabase.from("orders").select("id, status, market_id").in("id", ids);
  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  const byId = new Map(((data ?? []) as { id: string; status: string; market_id: string }[]).map((r) => [r.id, r]));

  const restored: string[] = [];
  const failed: Failure[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) { failed.push({ order_id: id, reason: "not_found" }); continue; }
    if (row.status !== "deleted") { failed.push({ order_id: id, reason: "not_deleted" }); continue; }
    if (!canRecoverDeletedOrder(actor.role, row.market_id, actor.market_id ?? "")) {
      failed.push({ order_id: id, reason: "forbidden" });
      continue;
    }
    const { error: rpcError } = await supabase.rpc("recover_deleted_order", {
      p_order_id: id,
      p_actor_id: actor.id,
      p_note: "Commande restaurée",
    });
    if (!rpcError) { restored.push(id); continue; }
    const code = (rpcError as { code?: string }).code;
    failed.push({ order_id: id, reason: code === "23514" ? "not_recoverable" : readOrderLockError(rpcError) ? "locked" : code === "42501" ? "forbidden" : "failed" });
  }

  return NextResponse.json({ data: { restored, failed } });
}

export const POST = withRouteErrors("/api/orders/bulk-recover", "POST", handlePOST);
