import type { PollRunResult } from "@/lib/carriers/polling/poller";

export interface CronRequestInput {
  headers: Headers;
  expectedSecret: string;
  runCycle: () => Promise<PollRunResult[]>;
}

export interface CronResponse {
  status: number;
  body: {
    success?: boolean;
    results?: PollRunResult[];
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

export async function handlePollCronRequest(
  input: CronRequestInput
): Promise<CronResponse> {
  if (!input.expectedSecret) {
    return { status: 500, body: { error: "CRON_SECRET not configured" } };
  }

  const provided = input.headers.get("x-cron-secret") ?? "";
  if (!timingSafeEqual(provided, input.expectedSecret)) {
    return { status: 401, body: { error: "Unauthorized" } };
  }

  try {
    const results = await input.runCycle();
    return { status: 200, body: { success: true, results } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: 500, body: { error: message } };
  }
}
