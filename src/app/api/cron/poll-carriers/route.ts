import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { buildProductionDeps, runPollCycle } from "@/lib/carriers/polling/poller";
import { runAllCarrierPolls } from "@/lib/carriers/polling/run-all";
import { pollXDelivery } from "@/lib/carriers/xdelivery/sync";
import { buildXDeliveryPollDeps, buildXDeliveryPickupDeps } from "@/lib/carriers/xdelivery/production";
import { requestPendingPickups } from "@/lib/carriers/xdelivery/pickup";
import { handlePollCronRequest } from "./handler";
import { withRouteErrors } from "@/lib/journal/route-errors";
import { startJobRun } from "@/lib/journal/job-run";

export const dynamic = "force-dynamic";

async function handlePOST(req: NextRequest) {
  const result = await handlePollCronRequest({
    headers: req.headers,
    expectedSecret: process.env.CRON_SECRET ?? "",
    runCycle: async () => {
      const admin = createAdminClient();
      return runAllCarrierPolls([
        () => runPollCycle(buildProductionDeps(admin)),
        async () => {
          const result = await pollXDelivery(buildXDeliveryPollDeps(admin));
          // After the status poll, so parcels already PENDING at X-Delivery are
          // known and not asked for twice. Never allowed to fail the poll.
          try {
            await requestPendingPickups(buildXDeliveryPickupDeps(admin));
          } catch (err) {
            console.error("[poll-carriers] xdelivery pickup request failed", err instanceof Error ? err.message : err);
          }
          return result;
        },
      ]);
    },
    startRun: () => startJobRun(createAdminClient(), "poll-carriers"),
  });
  return NextResponse.json(result.body, { status: result.status });
}

export const POST = withRouteErrors("/api/cron/poll-carriers", "POST", handlePOST);
