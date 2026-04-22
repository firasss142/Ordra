import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { buildProductionDeps, runPollCycle } from "@/lib/carriers/polling/poller";
import { handlePollCronRequest } from "./handler";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const result = await handlePollCronRequest({
    headers: req.headers,
    expectedSecret: process.env.CRON_SECRET ?? "",
    runCycle: async () => {
      const admin = createAdminClient();
      const deps = buildProductionDeps(admin);
      return runPollCycle(deps);
    },
  });
  return NextResponse.json(result.body, { status: result.status });
}
