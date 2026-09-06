import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { runSyncForMarket } from "@/lib/google-sheets/run-sync";
import type { SyncResult } from "@/lib/google-sheets/sync-engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function isAuthorized(req: NextRequest, expected: string): boolean {
  if (!expected) return false;

  const xSecret = req.headers.get("x-cron-secret");
  if (xSecret && timingSafeEqual(xSecret, expected)) return true;

  const auth = req.headers.get("authorization") ?? "";
  if (auth.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length);
    if (timingSafeEqual(token, expected)) return true;
  }

  return false;
}

async function run(req: NextRequest): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET ?? "";
  if (!isAuthorized(req, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminClient = createAdminClient();

  // One budget for the whole invocation, shared across markets. pg_net gives up
  // at 55s and the function is killed at 60; every market must hand back before
  // then, because work that is not handed back is work that is redone forever.
  const deadlineAt = Date.now() + 45_000;

  const { data: markets } = await adminClient
    .from("markets")
    .select("id")
    .eq("is_active", true);

  if (!markets || markets.length === 0) {
    return NextResponse.json({ ok: true, results: [] });
  }

  const allResults: Array<{ market_id: string; results: SyncResult[] }> = [];

  for (const market of markets) {
    try {
      const results = await runSyncForMarket(adminClient, market.id as string, {
        trigger: "cron",
        deadlineAt,
      });
      allResults.push({ market_id: market.id as string, results });
    } catch (err) {
      allResults.push({
        market_id: market.id as string,
        results: [{
          storefront_id: "unknown",
          rows_fetched: 0,
          rows_imported: 0,
          rows_duplicate: 0,
          rows_errored: 1,
          rows_skipped: 0,
          last_row: 0,
          has_more: false,
          errors: [{ row: 0, message: err instanceof Error ? err.message : "Unknown error" }],
        }],
      });
    }
  }

  return NextResponse.json({ ok: true, results: allResults });
}

export const GET = run;
export const POST = run;
