import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { buildProductionDeps, runPollCycle } from "@/lib/carriers/polling/poller";
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
      const deps = buildProductionDeps(admin);
      return runPollCycle(deps);
    },
    startRun: () => startJobRun(createAdminClient(), "poll-carriers"),
  });
  return NextResponse.json(result.body, { status: result.status });
}

export const POST = withRouteErrors("/api/cron/poll-carriers", "POST", handlePOST);
