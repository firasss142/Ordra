import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { withRouteErrors } from "@/lib/journal/route-errors";

export const dynamic = "force-dynamic";

/**
 * « Pas un doublon » — Commandes répétées › En double.
 *
 * Writes every order of the group to duplicate_dismissals; the duplicates list
 * and the row tags then leave the group alone until a new copy arrives
 * (lib/duplicate-orders/dismissals). Managers and super admins only; agents
 * see the screen read-only.
 */
const bodySchema = z.object({ order_ids: z.array(z.string().uuid()).min(2).max(50) });

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
  if (ids.length < 2) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase.from("orders").select("id, market_id").in("id", ids);
  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  const rows = (data ?? []) as { id: string; market_id: string }[];
  if (rows.length !== ids.length) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (actor.role === "market_manager" && rows.some((r) => r.market_id !== actor.market_id)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const byId = new Map(rows.map((r) => [r.id, r.market_id]));
  const { error: writeError } = await supabase.from("duplicate_dismissals").upsert(
    ids.map((id) => ({ order_id: id, market_id: byId.get(id)!, dismissed_by: actor.id })),
    { onConflict: "order_id", ignoreDuplicates: true },
  );
  if (writeError) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  return NextResponse.json({ data: { dismissed: ids.length } });
}

export const POST = withRouteErrors("/api/orders/duplicates/dismiss", "POST", handlePOST);
