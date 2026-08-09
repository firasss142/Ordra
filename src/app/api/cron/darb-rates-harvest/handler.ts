import type { HarvestRunSummary } from "@/lib/carriers/darb-rate-harvest";

/**
 * Auth + response shaping for the nightly Darb rate harvest, split out of
 * route.ts so it is testable without Next's request plumbing (same pattern as
 * api/cron/poll-carriers/handler.ts).
 */

export interface RateHarvestCronInput {
  headers: Headers;
  expectedSecret: string;
  limit: number;
  runHarvestCycle: (limit: number) => Promise<HarvestRunSummary>;
}

export interface RateHarvestCronResponse {
  status: number;
  body: {
    success?: boolean;
    summary?: HarvestRunSummary;
    error?: string;
  };
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function handleRateHarvestCronRequest(
  input: RateHarvestCronInput,
): Promise<RateHarvestCronResponse> {
  if (!input.expectedSecret) {
    return { status: 500, body: { error: "CRON_SECRET not configured" } };
  }

  const provided = input.headers.get("x-cron-secret") ?? "";
  if (!timingSafeEqual(provided, input.expectedSecret)) {
    return { status: 401, body: { error: "Unauthorized" } };
  }

  try {
    const summary = await input.runHarvestCycle(input.limit);
    // A partial run is still a 200: some cells failed, but the run itself
    // worked and the scheduler must not retry-storm. `summary.status` and
    // darb_rate_harvest_runs carry the detail.
    return { status: 200, body: { success: true, summary } };
  } catch (err) {
    // Never echo the error verbatim — a carrier config error can carry the
    // vendor api key through its message.
    console.error("[darb-rates-harvest] cycle failed:", err);
    return { status: 500, body: { error: "Harvest cycle failed" } };
  }
}
