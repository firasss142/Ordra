import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";

export const dynamic = "force-dynamic";

interface RawBucket {
  bucket: string;
  total: number;
  failed: number;
}

function emptyBuckets(windowMinutes: number): RawBucket[] {
  const now = Date.now();
  const out: RawBucket[] = [];
  for (let i = windowMinutes - 1; i >= 0; i--) {
    const d = new Date(now - i * 60_000);
    d.setSeconds(0, 0);
    out.push({ bucket: d.toISOString(), total: 0, failed: 0 });
  }
  return out;
}

function bucketize(
  rows: { created_at: string; isFailed: boolean }[],
  windowMinutes: number,
): RawBucket[] {
  const buckets = emptyBuckets(windowMinutes);
  const index = new Map(buckets.map((b, i) => [b.bucket, i]));
  for (const row of rows) {
    const d = new Date(row.created_at);
    d.setSeconds(0, 0);
    const key = d.toISOString();
    const i = index.get(key);
    if (i === undefined) continue;
    buckets[i].total += 1;
    if (row.isFailed) buckets[i].failed += 1;
  }
  return buckets;
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  if (actor.role !== "super_admin")
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sp = req.nextUrl.searchParams;
  const windowMinutes = Math.min(
    240,
    Math.max(15, parseInt(sp.get("window") ?? "60", 10)),
  );
  const sinceIso = new Date(Date.now() - windowMinutes * 60_000).toISOString();

  const [webhookRes, carrierRes] = await Promise.all([
    supabase
      .from("webhook_delivery_log")
      .select("created_at, status")
      .gte("created_at", sinceIso),
    supabase
      .from("carrier_event_log")
      .select("created_at, outcome")
      .gte("created_at", sinceIso),
  ]);

  if (webhookRes.error || carrierRes.error) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  let webhookFailed = 0;
  const webhookRows = (webhookRes.data ?? []).map((r) => {
    const isFailed = r.status === "error";
    if (isFailed) webhookFailed++;
    return { created_at: r.created_at as string, isFailed };
  });

  let carrierFailed = 0;
  const carrierRows = (carrierRes.data ?? []).map((r) => {
    const isFailed = r.outcome === "error";
    if (isFailed) carrierFailed++;
    return { created_at: r.created_at as string, isFailed };
  });

  const webhookBuckets = bucketize(webhookRows, windowMinutes);
  const carrierBuckets = bucketize(carrierRows, windowMinutes);

  const webhookTotals = webhookRows.length;
  const carrierTotals = carrierRows.length;

  return NextResponse.json({
    window_minutes: windowMinutes,
    webhook: {
      total: webhookTotals,
      failed: webhookFailed,
      failure_rate: webhookTotals ? webhookFailed / webhookTotals : 0,
      buckets: webhookBuckets,
    },
    carrier: {
      total: carrierTotals,
      failed: carrierFailed,
      failure_rate: carrierTotals ? carrierFailed / carrierTotals : 0,
      buckets: carrierBuckets,
    },
  });
}
