import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { handleXDeliveryWebhook } from "@/lib/carriers/xdelivery/webhook";
import { applyXDeliveryUpdates } from "@/lib/carriers/xdelivery/sync";
import { buildXDeliverySyncDeps, loadXDeliveryAccounts } from "@/lib/carriers/xdelivery/production";
import { withRouteErrors } from "@/lib/journal/route-errors";

/**
 * POST /api/webhooks/xdelivery — X-Delivery status push.
 *
 * Their support registers this URL on our company (we cannot). Auth is
 * `Authorization: Bearer <API key>` of one of our X-Delivery accounts; the
 * matching account scopes which parcels the update may touch. Contract and
 * failure behaviour: src/lib/carriers/xdelivery/webhook.ts.
 */

export const dynamic = "force-dynamic";

async function handlePOST(request: NextRequest) {
  const admin = createAdminClient();
  const result = await handleXDeliveryWebhook({
    authorization: request.headers.get("authorization"),
    rawBody: await request.text(),
    deps: {
      loadAccounts: () => loadXDeliveryAccounts(admin),
      applyUpdates: (updates, carrierId) =>
        applyXDeliveryUpdates(updates, "webhook", buildXDeliverySyncDeps(admin, [carrierId])),
    },
  });
  return NextResponse.json(result.body, { status: result.status });
}

export const POST = withRouteErrors("/api/webhooks/xdelivery", "POST", handlePOST);
