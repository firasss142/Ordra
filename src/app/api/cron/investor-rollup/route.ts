import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { runInvestorRollup, type RollupMode } from "@/lib/investors/rollup-run";

export const dynamic = "force-dynamic";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Accepts the manual-test header `x-cron-secret: <s>` AND `Authorization:
// Bearer <s>` — same contract as the other cron routes.
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Investor v2 rollup — scheduled by pg_cron (20260920000003):
 *   ?mode=incremental   (every 15 min) orders that moved since the watermark
 *   ?mode=full&product_id=<uuid>  (nightly, per product) full recompute
 *
 * Idempotent: facts upsert on (order_id, product_id) with snapshot-preserving
 * trigger; daily rows overwrite on (product_id, fact_date); deal snapshots
 * overwrite on deal_id. Concurrency: claim_investor_rollup_run advisory lock.
 */
async function run(req: NextRequest) {
  const expected = process.env.CRON_SECRET ?? "";
  if (!isAuthorized(req, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = req.nextUrl.searchParams;
  const modeParam = params.get("mode") ?? "incremental";
  if (modeParam !== "incremental" && modeParam !== "full") {
    return NextResponse.json({ error: "mode must be incremental or full" }, { status: 400 });
  }
  const mode = modeParam as RollupMode;
  const productId = params.get("product_id");
  if (productId && !UUID.test(productId)) {
    return NextResponse.json({ error: "product_id must be a uuid" }, { status: 400 });
  }

  const admin = createAdminClient();
  const result = await runInvestorRollup(admin, { trigger: "cron", mode, productId });

  const status = result.status === "failed" ? 500 : result.status === "partial" ? 207 : 200;
  return NextResponse.json({ data: result }, { status });
}

export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}
