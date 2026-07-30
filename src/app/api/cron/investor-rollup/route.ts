import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { computeDailyRollup, persistDailyRollup } from "@/lib/investors/load-rollup";

export const dynamic = "force-dynamic";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// Accepts the manual-test header `x-cron-secret: <s>` AND Vercel Cron's
// `Authorization: Bearer <s>` — same contract as the other cron routes.
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

/** YYYY-MM-DD, N days before today (UTC). */
function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

const MAX_LOOKBACK_DAYS = 30;

/**
 * Recomputes recent days of the investor rollup.
 *
 * Defaults to a 3-day trailing window rather than just yesterday, because
 * carrier delivery and return events routinely land a day or two after the
 * fact. Re-folding those days is safe: the upsert is keyed on
 * (stat_date, market_id, product_id), so a replay overwrites rather than
 * double-counts.
 *
 * Query params (both optional):
 *   ?days=N       how many trailing days to recompute (1-30, default 3)
 *   ?date=ISO     recompute exactly one day, for backfills
 */
async function run(req: NextRequest) {
  const expected = process.env.CRON_SECRET ?? "";
  if (!isAuthorized(req, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const params = req.nextUrl.searchParams;

  let dates: string[];
  const explicitDate = params.get("date");

  if (explicitDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(explicitDate)) {
      return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
    }
    dates = [explicitDate];
  } else {
    const requested = Number(params.get("days") ?? 3);
    if (!Number.isFinite(requested) || requested < 1 || requested > MAX_LOOKBACK_DAYS) {
      return NextResponse.json(
        { error: `days must be between 1 and ${MAX_LOOKBACK_DAYS}` },
        { status: 400 },
      );
    }
    dates = Array.from({ length: requested }, (_, i) => isoDaysAgo(i));
  }

  const { data: markets, error: marketError } = await admin
    .from("markets")
    .select("id, code")
    .eq("is_active", true);

  if (marketError) {
    console.error("[cron/investor-rollup] market fetch failed:", marketError);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  const results: {
    date: string;
    market: string;
    rows: number;
    error?: string;
  }[] = [];

  for (const date of dates) {
    for (const market of markets ?? []) {
      try {
        const stats = await computeDailyRollup(admin, date, market.id);
        const written = await persistDailyRollup(admin, stats);
        results.push({ date, market: market.code, rows: written });
      } catch (err) {
        // One bad market-day must not abort the rest of the window.
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[cron/investor-rollup] ${market.code} ${date} failed:`, message);
        results.push({ date, market: market.code, rows: 0, error: message });
      }
    }
  }

  const failed = results.filter((r) => r.error);

  return NextResponse.json(
    {
      success: failed.length === 0,
      days: dates.length,
      rowsWritten: results.reduce((sum, r) => sum + r.rows, 0),
      failures: failed.length,
      results,
    },
    { status: failed.length > 0 ? 207 : 200 },
  );
}

export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}
