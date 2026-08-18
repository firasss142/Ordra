import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { canManageInvestments } from "@/lib/investor-permissions";
import { runInvestorRollup } from "@/lib/investors/rollup-run";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Operator path for the rollup (the cron needs CRON_SECRET and cannot be
 * called from a browser — the v1 dead-end). Same engine, trigger='manual'.
 * Body: { mode?: 'incremental' | 'full', product_id?: uuid }
 */
export async function POST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  if (!canManageInvestments(actorResult.actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { mode?: string; product_id?: string } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    body = {};
  }
  const mode = body.mode ?? "incremental";
  if (mode !== "incremental" && mode !== "full") {
    return NextResponse.json({ error: "mode must be incremental or full" }, { status: 400 });
  }
  const productId = body.product_id ?? null;
  if (productId && !UUID.test(productId)) {
    return NextResponse.json({ error: "product_id must be a uuid" }, { status: 400 });
  }

  const admin = createAdminClient();
  const result = await runInvestorRollup(admin, { trigger: "manual", mode, productId });
  const status = result.status === "failed" ? 500 : result.status === "skipped_locked" ? 409 : result.status === "partial" ? 207 : 200;
  return NextResponse.json({ data: result }, { status });
}
