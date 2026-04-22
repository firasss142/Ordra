import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { applyFulfillmentTransition } from "@/lib/orders/fulfillment";
import {
  handleNavexWebhook,
  type NavexWebhookDeps,
  type NavexOrderLookup,
} from "@/lib/navex-webhook-handler";
import type { OrderStatus } from "@/types/order-status";

export async function POST(request: NextRequest) {
  const expectedToken = process.env.NAVEX_WEBHOOK_SECRET ?? "";
  const token = request.nextUrl.searchParams.get("token");
  const rawBody = await request.text();

  const admin = createAdminClient();

  const deps: NavexWebhookDeps = {
    expectedToken,
    findOrderByTracking: async (tracking) => {
      const { data } = await admin
        .from("orders")
        .select("id, status")
        .eq("tracking_number", tracking)
        .limit(1)
        .maybeSingle();
      return (data as NavexOrderLookup | null) ?? null;
    },
    findOrderByExternalId: async (externalId) => {
      const { data } = await admin
        .from("orders")
        .select("id, status")
        .eq("external_id", externalId)
        .limit(1)
        .maybeSingle();
      return (data as NavexOrderLookup | null) ?? null;
    },
    applyFulfillment: async ({ orderId, newStatus, isDamaged, note }) => {
      await applyFulfillmentTransition(
        admin,
        orderId,
        newStatus as OrderStatus,
        null,
        { isDamaged, note }
      );
    },
    writeLog: async (entry) => {
      const { error } = await admin.from("carrier_event_log").insert({
        carrier_code: entry.carrier_code,
        source: entry.source,
        tracking_number: entry.tracking_number,
        carrier_status_raw: entry.carrier_status_raw,
        order_id: entry.order_id,
        outcome: entry.outcome,
        outcome_reason: entry.outcome_reason,
        raw_body: entry.raw_body,
      });
      if (error) throw new Error(error.message);
    },
  };

  try {
    const result = await handleNavexWebhook({ token, rawBody, deps });
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    console.error("navex webhook: unhandled exception", err);
    return NextResponse.json({ received: true }, { status: 200 });
  }
}
