import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { syncAllAccounts } from "@/lib/meta-ads/sync";

/**
 * Hourly pull of campaign-level spend from Meta.
 *
 * Scheduled by pg_cron, not Vercel: the Hobby plan caps crons at once per day
 * and a sub-daily entry in vercel.json's `crons` key fails config validation
 * for every deployment, which is why all five existing jobs live in the
 * database (docs/notifications-cron.md). Only the `functions` key is safe to
 * touch, and it is used below for maxDuration.
 */

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

  // pg_net gives up at 55s and the function is killed at 60. Everything must
  // hand back before then: work that is not handed back is work that is redone
  // forever. 45s leaves room for the final writes.
  const deadlineAt = Date.now() + 45_000;

  try {
    const results = await syncAllAccounts(adminClient, {
      trigger: "cron",
      deadlineAt,
    });
    return NextResponse.json({ ok: true, results });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export const GET = run;
export const POST = run;
