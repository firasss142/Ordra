import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { buildProductionDeps, runPollCycle } from "@/lib/carriers/polling/poller";
import { runAllCarrierPolls } from "@/lib/carriers/polling/run-all";
import { pollXDelivery } from "@/lib/carriers/xdelivery/sync";
import { buildManifestSyncDeps, buildXDeliveryPollDeps } from "@/lib/carriers/xdelivery/production";
import { syncXDeliveryManifests } from "@/lib/carriers/xdelivery/manifest-sync";
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
          // The lists (pickup, return, exchange) after the statuses. Pickup is no
          // longer requested here — it is a button (plans/xdelivery-manifests.md);
          // this only imports lists and follows a pickup list undone on their
          // portal. Never allowed to fail the poll.
          try {
            await syncXDeliveryManifests(buildManifestSyncDeps(admin));
          } catch (err) {
            console.error("[poll-carriers] xdelivery manifest sync failed", err instanceof Error ? err.message : err);
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
