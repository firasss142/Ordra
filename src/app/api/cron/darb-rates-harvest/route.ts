import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { runDarbRateHarvestCycle } from "@/lib/carriers/darb-rate-harvest-cycle";
import { handleRateHarvestCronRequest } from "./handler";

export const dynamic = "force-dynamic";

/** Cells per run. 556 covers the whole catalogue for both accounts. */
const DEFAULT_LIMIT = 600;

export async function POST(req: NextRequest) {
  const limitParam = Number(req.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : DEFAULT_LIMIT;

  const result = await handleRateHarvestCronRequest({
    headers: req.headers,
    expectedSecret: process.env.CRON_SECRET ?? "",
    limit,
    runHarvestCycle: (n) => runDarbRateHarvestCycle(createAdminClient(), { limit: n }),
  });

  return NextResponse.json(result.body, { status: result.status });
}
