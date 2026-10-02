import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canReadStorefrontHealth } from "@/lib/settings-permissions";

export const dynamic = "force-dynamic";

const WINDOW_DAYS = 30;

/**
 * GET /api/storefronts/activity?market_id=
 *
 * Per shop: how many orders it sent in the last 30 days and when it sent its
 * last one — read from `orders`, never from the webhook columns. The Google
 * Sheets shop that carries almost all of Libya's orders has never received a
 * webhook, so `last_webhook_received_at` would call it dead.
 *
 * super_admin names the market; a market_manager always gets their own.
 * Response: { data: [{ storefront_id, orders_30d, last_order_at }] }
 */
export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  const marketId =
    actor.role === "super_admin"
      ? req.nextUrl.searchParams.get("market_id")
      : actor.market_id;
  if (!marketId) {
    return NextResponse.json(
      { error: actor.role === "super_admin" ? "market_id is required" : "Forbidden" },
      { status: actor.role === "super_admin" ? 400 : 403 },
    );
  }
  if (!canReadStorefrontHealth(actor.role, marketId, actor.market_id ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: shops, error } = await supabase
    .from("storefronts")
    .select("id")
    .eq("market_id", marketId);
  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });

  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

  const data = await Promise.all(
    ((shops ?? []) as { id: string }[]).map(async ({ id }) => {
      const [recent, last] = await Promise.all([
        supabase
          .from("orders")
          .select("id", { count: "exact", head: true })
          .eq("storefront_id", id)
          .gte("created_at", since),
        supabase
          .from("orders")
          .select("created_at")
          .eq("storefront_id", id)
          .order("created_at", { ascending: false })
          .limit(1),
      ]);
      const lastRow = ((last.data ?? []) as { created_at: string }[])[0];
      return {
        storefront_id: id,
        orders_30d: recent.count ?? 0,
        last_order_at: lastRow?.created_at ?? null,
      };
    }),
  );

  return NextResponse.json({ data });
}
