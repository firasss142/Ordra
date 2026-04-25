import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canReadStorefrontHealth } from "@/lib/settings-permissions";

interface DeliveryRow {
  id: string;
  event: string;
  status: "processed" | "ignored" | "error";
  error_message: string | null;
  created_at: string;
  order_id: string | null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  const admin = createAdminClient();

  const { data: sf, error: sfError } = await admin
    .from("storefronts")
    .select(
      "id, market_id, name, platform, is_active, last_webhook_received_at, last_webhook_status, last_webhook_error, webhook_failure_count",
    )
    .eq("id", id)
    .single();

  if (sfError || !sf) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!canReadStorefrontHealth(actor.role, sf.market_id, actor.market_id ?? "")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: deliveries } = await admin
    .from("webhook_delivery_log")
    .select("id, event, status, error_message, created_at, order_id")
    .eq("storefront_id", id)
    .order("created_at", { ascending: false })
    .limit(20);

  // Aggregate last-7-day counts
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const { data: recent7 } = await admin
    .from("webhook_delivery_log")
    .select("status")
    .eq("storefront_id", id)
    .gte("created_at", sevenDaysAgo.toISOString());

  const counts = { processed: 0, ignored: 0, error: 0 };
  for (const row of recent7 ?? []) {
    if (row.status in counts) {
      counts[row.status as keyof typeof counts] += 1;
    }
  }

  return NextResponse.json({
    data: {
      storefront: {
        id: sf.id,
        name: sf.name,
        platform: sf.platform,
        is_active: sf.is_active,
        last_webhook_received_at: sf.last_webhook_received_at,
        last_webhook_status: sf.last_webhook_status,
        last_webhook_error: sf.last_webhook_error,
        webhook_failure_count: sf.webhook_failure_count,
      },
      recent_deliveries: (deliveries ?? []) as DeliveryRow[],
      counts_last_7d: counts,
    },
  });
}
